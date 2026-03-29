# ADR: Separate reindex partial recovery warnings by failure cause

- Status: Proposed
- Date: 2026-03-30

## Context

`src/reindexUtils.ts` の `reindexBagFromBuffer()` は、unindexed な ROS1 bag を走査して `IndexData`、top-level `Connection` record、`ChunkInfo` を再構築する。
この処理は partial recovery を許容しており、壊れた chunk や復旧不能な部分があっても、読み出せる範囲をできるだけ残す方針を採っている。

現状の実装では、chunk 内の `OP_MESSAGE_DATA` から `conn` ごとの index を再生成できる一方で、top-level `Connection` record は `OP_CONNECTION` から取得できた metadata に依存している。
そのため、先行 chunk が壊れている、または skip されており、その chunk でしか connection metadata を回収できなかった場合、後続 chunk の `IndexData` だけが生成され、対応する `Connection` record が欠落した reindexed bag を出力しうる。

この状態では `@foxglove/rosbag` が bag を reopen した際に `Unable to find connection with id ...` となり、partial recovery したはずの bag が結果として読めなくなる。

また、warning 表示では現在主に chunk 破損系の事象を扱っているが、以下の 2 種類は意味が異なる。

- chunk 内 record の破損や truncation により、chunk 自体を十分に読めないケース
- chunk 自体は読めるが、`conn` の metadata が不足しており、安全のためその `conn` を除外するケース

ユーザー方針は、`直せる限り直し、ダメな部分だけ通知を表示してスキップする` である。
そのため、復旧不能な原因をまとめて扱うのではなく、原因別に warning を分離し、復旧単位も適切に分ける必要がある。

## Decision

reindex の partial recovery で出す warning を、失敗原因ごとに分離する。

少なくとも以下を区別する。

- `chunk-record-corrupt`
  - chunk 内 record の破損、truncation、または chunk 自体の読取不能を表す
- `missing-connection-metadata`
  - `OP_MESSAGE_DATA` から `conn` は観測できたが、最終的にその `conn` に対応する `Connection` metadata を復元できなかったことを表す

また、`missing-connection-metadata` が発生した場合は、bag 全体を失敗にしない。
代わりに、該当 `conn` だけを warning 付きで除外し、復旧可能な他の `conn` は残す。

最終出力では、`Connection` metadata を持たない `conn` を `IndexData` や `ChunkInfo` からも除外し、reindexed bag の整合性を優先する。

## Decision Details

### 1. Warning の意味

#### `chunk-record-corrupt`

以下のようなケースで使用する。

- chunk 内 record を途中までしか読めない
- record header / payload が壊れている
- その chunk を安全に継続走査できない

この warning は主に chunk 単位の問題を表す。

#### `missing-connection-metadata`

以下のようなケースで使用する。

- `messageIndices` に含まれる `conn` がある
- しかし、最終的に `allConnections` にその `conn` が存在しない
- よって、その `conn` を参照する `IndexData` を出力すると bag が壊れる

この warning は主に connection 単位の問題を表す。

### 2. Metadata 欠損時の recovery 方針

`missing-connection-metadata` が発生した `conn` については、以下を行う。

- その `conn` の `IndexData` は出力しない
- その `conn` を `ChunkInfo.connectionCounts` に含めない
- top-level `Connection` record が存在しない `conn` を、最終出力中の参照対象に残さない

これにより、chunk raw bytes 内に該当メッセージが物理的に残っていても、index 上は見えなくなる場合がある。
これは `完全復旧` よりも `読める bag を維持する` ことを優先した結果とみなす。

### 3. Recovery 単位

- chunk 自体が壊れている場合は、必要に応じて chunk 単位で skip
- metadata が欠けているだけの場合は、conn 単位で skip

これにより、復旧可能なデータをなるべく多く残しつつ、壊れた reindexed bag の生成を防ぐ。

### 4. UI / i18n 反映方針

warning が原因別に分離されるため、UI 表示でも以下を区別できるようにする。

- chunk 破損により一部 chunk を読めなかった
- connection metadata 不足により一部接続を安全のため除外した

これにより、ユーザーは `何が壊れていたのか` と `何が除外されたのか` を理解しやすくなる。

### 5. テスト方針

以下を独立した観点として検証する。

- chunk 破損系 warning が正しく出る
- connection metadata 欠損 warning が正しく出る
- metadata 欠損があっても、reindexed bag が `@foxglove/rosbag` で reopen できる
- 圧縮 warning (`unsupported-compression`, `chunk-decompress-failed`) が fixture 条件に依存せず必ず実行される

## Alternatives Considered

### Alternative 1: `chunk-record-corrupt` に統一する

不採用。

理由:

- 原因が異なる
- 対処単位も異なる
- ユーザーや開発者から見ると `壊れている` のか `metadata が足りない` のか区別できない

### Alternative 2: metadata 欠損時は chunk ごと skip する

不採用。

理由:

- 同じ chunk に復旧可能な別 `conn` が含まれていてもまとめて失う
- ユーザー方針の `直せる限り直す` に反する

### Alternative 3: metadata 欠損時は bag 全体を失敗にする

不採用。

理由:

- partial recovery の方針に反する
- 一部だけ除外すれば読める bag を捨てることになる

### Alternative 4: warning を増やさずログやコメントだけで補う

不採用。

理由:

- UI 上の説明が曖昧なまま残る
- テスト観点も分離しづらい
- 将来の保守時に判断理由が埋もれる

## Consequences

### Positive

- failure cause をユーザーと開発者の両方が判別しやすくなる
- partial recovery の挙動が説明しやすくなる
- `IndexData` / `Connection` / `ChunkInfo` の整合性を設計として明文化できる
- テスト観点を原因別に分けられる

### Negative

- warning code、UI 分岐、i18n、テストの更新箇所が増える
- chunk raw bytes に残る message が index 上は見えなくなるケースがある
- warning の種類が増えることで UI がやや複雑になる

### Operational Impact

- 新しい warning code を追加した場合、`assertNever()` を使っている箇所の更新が必須になる
- 将来 warning を追加する場合も、`chunk 単位の問題か` `conn 単位の問題か` を判断基準にする必要がある

## Verification / Guardrails

以下を実装・テスト時の不変条件とする。

1. top-level `Connection` record を持たない `conn` を、`IndexData` や `ChunkInfo` から参照しない
2. partial recovery 後の bag は `@foxglove/rosbag` で reopen できること
3. metadata 欠損時は bag 全体を失敗にせず、該当 `conn` のみ warning 付きで除外すること
4. `chunk-record-corrupt` と `missing-connection-metadata` を別のテストケースで検証すること
5. `unsupported-compression` / `chunk-decompress-failed` の warning 分岐は、fixture 依存ではなく確実に実行されること

## Notes

この ADR は、partial recovery の設計原則として `読めるものを最大限残すが、整合性を壊す参照は出力しない` という方針を定義する。
