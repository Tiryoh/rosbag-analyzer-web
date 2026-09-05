# ADR: reindex 部分復旧の警告を失敗原因ごとに分離する

- Status: Accepted
- Date: 2026-03-30

## Context

`reindexBagFromBuffer()` は、未インデックスの ROS1 bag を走査してインデックスを再構築する。
chunk 内の `OP_MESSAGE_DATA` から接続（`conn`）ごとの index を作れるが、`Connection` レコードには `OP_CONNECTION` のメタデータが必要となる。

先行 chunk の破損でメタデータを回収できないと、対応する `Connection` のない `IndexData` が生成されることがある。
この bag を `@foxglove/rosbag` で再オープンすると、`Unable to find connection with id ...` エラーになる。

chunk 内レコードの破損とメタデータ欠損では、原因も除外すべき範囲も異なる。

## Decision

警告を失敗原因ごとに分離し、読み出せるデータを残しながら、整合性を壊す参照を除外する。

## Decision Details

### 1. 警告と復旧単位

- **`chunk-record-corrupt`**：chunk 内レコードの破損や切り詰めにより、走査を継続できない場合に使う。
  読み出せない chunk はスキップし、途中まで走査できた場合は回収済みのメタデータとメッセージインデックスを保持する。
- **`missing-connection-metadata`**：全 chunk の走査後も、メッセージインデックスにある `conn` のメタデータを回収できなかった場合に使う。
  該当 `conn` のみを除外し、同じ chunk 内の他の接続は残す。

### 2. メタデータ欠損時の復旧方針

メタデータが存在しない `conn` は、以下のように処理する。

- 当該 `conn` の `IndexData` を出力しない。
- `ChunkInfo.connectionCounts` から当該 `conn` を除外する。

トップレベル `Connection` のない接続への index 参照を除くことで、再オープン可能な bag を維持する。

### 3. UI 表示

chunk の破損で読み取れなかった部分と、メタデータ不足で除外した接続を区別して通知する。

## Alternatives Considered

- `chunk-record-corrupt` への統一：原因と対処単位の違いが伝わらないため不採用。
- メタデータ欠損時の chunk ごと除外：同じ chunk 内の復旧可能な接続まで失うため不採用。
- メタデータ欠損時のファイル全体の失敗：一部接続の除外で救済できるデータを失うため不採用。
- ログやコメントだけで補足：UI で除外理由を示せず、テストの観点も曖昧になるため不採用。

## Consequences

- 失敗原因と除外範囲が明確になり、接続メタデータの欠損による再オープン失敗を防げる。
- chunk 内にメッセージのバイト列が残っていても、index からは見えなくなる場合がある。
- 警告コードの追加に伴い、UI 表示、国際化、テストの対応箇所が増える。

## Verification / Guardrails

1. トップレベル `Connection` レコードを持たない `conn` を、`IndexData` や `ChunkInfo` から参照しない。
2. 部分復旧後の bag が `@foxglove/rosbag` で再オープンできる。
3. メタデータ欠損時に全体失敗とせず、該当 `conn` のみ警告付きで除外する。
4. `chunk-record-corrupt` と `missing-connection-metadata` を別々に検証し、破損箇所より前の正常なメッセージが残ることも確認する。
5. `unsupported-compression` と `chunk-decompress-failed` の警告分岐は、外部 fixture の状態に左右されず確実にテストする。
6. 新規警告コードの追加時は、`assertNever()` による網羅性チェックの対象箇所も更新する。
