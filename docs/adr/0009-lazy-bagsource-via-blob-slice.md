# ADR: BagSource をオフセット指定の遅延 Reader に変更する

- Status: Accepted
- Date: 2026-04-29

## Context

ADR 0008 (`Core と Web を分離し、Bag loaders をブラウザ非依存にする`) では、`BagSource = { name: string; data: Uint8Array }` を canonical な入力型として採用した。
当時は次の前提で「ストリーミング対応はしない」を意思決定の前提に置いていた。

- 既存実装が全量メモリロード前提で書かれており、`BagReader` / MCAP 双方の内部変更が必要
- 想定ユースケース（最大数百 MB）ではブラウザ単一 allocation でメモリが逼迫する兆候はない
- `BagSource` → `Filelike` への移行は後から足せる

しかしその後、ユーザーから「1 GB 級 bag をブラウザで開きたい」という具体的な要求が出てきた。`File.arrayBuffer()` で 1 GB を一括ロードすると次の問題が起きる。

- Chrome は単一 `ArrayBuffer` 確保に上限があり、大きなファイルでは `RangeError` / `NotReadableError` で失敗する
- 失敗しなくても、ピーク常駐メモリがファイルサイズと同じになり、後続のパース・export 処理と合わせて OOM のリスクが高まる
- ADR 0008 で fileAdapter に追加した「512 MB 超は事前にエラー」というガードは、結局ブラウザでファイルを開く手段を奪っているだけだった

`@foxglove/rosbag` の `Filelike` (`read(offset, length): Promise<Uint8Array>` + `size(): number`) と `@mcap/core` の `IReadable` (`read(offset, size): Promise<bigint>` + `size(): Promise<bigint>`) は、いずれもオフセット指定の遅延読みを前提に設計されている。
ブラウザ側でも `File extends Blob` であり、`Blob.slice(start, end).arrayBuffer()` は当該範囲だけを実際に読み出す lazy primitive として動作する。すなわち、入力型を遅延 Reader に変更するだけで、ライブラリ側の改造なしに「indexed なファイルなら chunk 単位の読み出ししかしない」状態にできる。

ADR 0008 の Decision Details §1 / Alternative 2 / Verification §2, §5 は、この前提変更により再評価が必要になる。

## Decision

`BagSource` をオフセット指定の遅延 Reader に置き換える。具体的には:

```ts
export interface BagSource {
  name: string;
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}
```

- `data: Uint8Array` フィールドは削除する
- `fileToBagSource(file: File): BagSource` は `File.arrayBuffer()` を呼ばず、`file.slice(...).arrayBuffer()` を内部に持つ薄いアダプタとして実装する
- 512 MB の事前ガードは撤廃する。ピークメモリは「現在パース中の chunk」程度に下がるため、ファイルサイズに基づく拒否は不要

ADR 0008 の以下を supersede する。

- Decision Details §1（`BagSource.data: Uint8Array`）
- Decision Details §3 のうち「`fileToBagSource` が `File.arrayBuffer()` と 512 MB ガードを担う」部分
- Alternative 2（`Filelike` を採用しない）
- Verification §5（`fileToBagSource` 以外で `File.arrayBuffer()` を呼ばない）

ADR 0008 のその他の決定（Core と Web の物理分割、`severityStyles.ts` 分離、`reindexedBytes: Uint8Array` の返却、`downloadBlob` 群の Web 限定、Core が DOM 型を実装内で参照しない）はそのまま維持する。

## Decision Details

### 1. Reader の意味論

- `read(offset, length)` は呼び出しごとに新しい `Uint8Array` を返す。返り値はパーサがその場で消費する想定で、`BagSource` 側は内部キャッシュを持たない
- `size` は同期取得可能とする（`@foxglove/rosbag` の `Filelike.size(): number` の意味論に揃える）。`@mcap/core` 側で必要な `bigint` への変換はアダプタ層で行う

### 2. アダプタ

- `src/core/rosbagUtils.ts` 内の `bagSourceToFilelike(source): Filelike` で `BagSource` を `@foxglove/rosbag` の `Filelike` に変換する
- `src/core/mcapUtils.ts` 内の `BagSourceReadable implements IReadable` で `@mcap/core` 用に変換する
- 既存の `Uint8ArrayReader` / `Uint8ArrayReadable` は、reindex 後に in-memory `Uint8Array` を再オープンする経路でのみ残す（reindex は本質的に全量バッファを生成するため）

### 3. 全量 materialize が必要なパス（明示的に許容）

次の経路はオフセット読みでは成立しないため、`source.read(0, source.size)` で一度だけ全量を読む。

- ROS1 bag の reindex（`reindexBagFromBuffer`）— 末尾 index が壊れているケース限定の fallback パス
- `.mcap.zstd` の outer zstd 解凍（`fzstd.decompress` が `Uint8Array` 全体を要求するため）
- MCAP indexed reader が record をひとつも返さなかった unchunked MCAP に対する `McapStreamReader` への fallback（不正・未対応 MCAP 限定）

通常の indexed bag / MCAP では全量 materialize は発生しない。

### 4. ブラウザでの lazy 性

`File.slice(start, end)` は `Blob` を返すだけで実バイト読み出しを行わず、`.arrayBuffer()` を呼んだ時点で当該範囲のみが読まれる。これによりブラウザのピーク常駐メモリは、indexed bag では「現在パース中の chunk」程度に収まる。

### 5. エラー文言

512 MB ガード自体が不要になるため、それに対応する英語ハードコード文言（`Failed to read file (... MB). Too large to load into browser memory.`）も削除する。
core 側で発生するエラー（空ファイル、reindex 失敗等）は ADR 0006 の方針に沿って `BagLoadError(code, params)` で構造化し、UI 境界で `tf()` を通じて翻訳する。

## Alternatives Considered

### Alternative 1: ADR 0008 の `data: Uint8Array` を維持し、`fileToBagSource` だけ `Blob` を保持する内部実装にする

不採用。
`BagSource.data` のシグネチャが残るとパース系コードが `data.byteLength` / `subarray` で全量アクセス前提を持ち続け、結局どこかで `data` を生成して全量 materialize する分岐が紛れ込む。境界を「lazy read」に揃える方が静的に安全。

### Alternative 2: `BagSource` をユニオン型 (`{ name; data: Uint8Array } | { name; size; read }`) にする

不採用。
parser 側で常にパターンマッチを書く必要が出るうえ、両分岐を維持するコストが効果に見合わない。`Uint8Array` を持っているケースも、薄いラッパで lazy reader として扱える（`bytes.slice(o, o+l)` を返すだけ）。

### Alternative 3: ROS1 bag も含めて真にストリーミング処理する

不採用（将来再検討可）。
`@foxglove/rosbag` の `Bag` は random access を前提にしており、真のストリーミング処理にはライブラリ改造が必要。本 ADR の「Blob.slice ベースの遅延 Reader」で indexed bag のメモリ問題はすでに解消されるため、現時点で追加投資はしない。

## Consequences

### Positive

- 1 GB 超の indexed bag でも、Chrome のメモリ上限に当たらず開ける
- ピーク常駐メモリが「ファイルサイズ」から「処理中の chunk サイズ」に下がる
- 512 MB ガードを撤廃でき、UX が単純になる（ブラウザでサイズ制限せずに試せる）
- Core が依然として `Blob` / `File` / `document` を実装内で参照しないため、ADR 0008 の Verification §1 / §2 / §6 / §7 / §8 はそのまま満たされる

### Negative

- `BagSource` 利用側は `data` への直接アクセスができなくなる。reindex 経路など必要箇所では `await source.read(0, source.size)` を明示的に書く
- ROS1 bag の reindex は引き続き全量 materialize が必要（壊れた bag に対する fallback 限定なので、indexed 経路の最適化は損なわれない）

### Operational Impact

- 新規 loader / parser を追加する場合、`BagSource.read(offset, length)` を介してアクセスする
- 全量 materialize が本当に必要な箇所では、その理由（外部ライブラリの API 制約など）を ADR か実装コメントで明記する
- ADR 0008 の Verification §5（`File.arrayBuffer()` を fileToBagSource 以外で呼ばない）は本 ADR で撤廃される。代わりに「`File.arrayBuffer()` を実装内で呼ばない」を新たな不変条件とする

## Verification / Guardrails

1. `BagSource` の型は `{ name: string; size: number; read(offset, length): Promise<Uint8Array> }` のみ。`data: Uint8Array` は再導入しない
2. `src/web/fileAdapter.ts` の `fileToBagSource` は `File.arrayBuffer()` を呼ばない。`file.slice(...).arrayBuffer()` のみを使う
3. `src/core/**` で `source.read(0, source.size)` を呼ぶ箇所は、reindex / 外側 zstd 解凍 / 不正 MCAP の streaming fallback に限定し、新規追加時は ADR か実装コメントで根拠を残す
4. ADR 0008 の Verification §1 / §2 / §3 / §4 / §6 / §7 / §8 は引き続き満たす
5. ブラウザ E2E は数百 MB 〜 1 GB クラスの indexed bag でアップロード→loaded 状態に到達できることを目安に確認する（自動 E2E は小サイズの fixture で十分）
