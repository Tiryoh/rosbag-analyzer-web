# ADR: BagSource をオフセット指定の遅延 Reader に変更する

- Status: Accepted
- Date: 2026-04-29

## Context

[ADR 0008](0008-core-web-split-for-non-browser-reuse.md) では全量読み込みを採用したが、1 GB 級の bag を開く要件に対し、次の問題があった。

- 単一 `ArrayBuffer` の確保上限による `RangeError` や `NotReadableError` の発生
- ファイル全量をメモリに保持することによる OOM リスク
- 暫定的な 512 MB ガードによる、大容量ファイルの読み込み拒否

一方、`@foxglove/rosbag` と `@mcap/core` はオフセット指定の読み込みに対応している。
`Blob.slice(start, end).arrayBuffer()` と組み合わせれば、ライブラリを改造せずに必要な範囲だけを読み込める。

## Decision

`BagSource` をオフセット指定の遅延 Reader インターフェースに置き換える。

```ts
export interface BagSource {
  name: string;
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}
```

ADR 0008 の `BagSource.data`、全量読み込み、512 MB ガードを置き換える。
Core/Web の分割、スタイル分離、reindex 結果の返却形式は維持する。

## Decision Details

### 1. Reader の仕様

- `read(offset, length)` はキャッシュを持たず、呼び出しごとに新しい `Uint8Array` を返す。
- `size` は同期取得可能とし、`@foxglove/rosbag` の仕様に合わせる。
  `@mcap/core` が要求する `bigint` への変換はアダプタで行う。

### 2. アダプタの実装

- Web 側の `fileToBagSource` は `file.slice(...).arrayBuffer()` で必要な範囲だけを読み込む。
- `src/core/rosbagUtils.ts` の `bagSourceToFilelike` により `@foxglove/rosbag` の `Filelike` に変換する。
- `src/core/mcapUtils.ts` の `BagSourceReadable` により `@mcap/core` の `IReadable` に変換する。
- reindex 後や外側 zstd 展開後のバイト列には、`Uint8Array` 向け Reader を使う。

### 3. 全量読み出しを許容する例外パス

現行の実装で全バイト列が必要な以下の処理には、`source.read(0, source.size)` を許容する。

- 未インデックス ROS1 bag の reindex 処理（末尾 index 欠落時のフォールバック）
- `.mcap.zstd` のファイル全体の解凍処理（`fzstd` の制約）
- indexed reader が失敗した場合、または Message レコードを返さない MCAP（unchunked など）のストリーミングフォールバック

### 4. エラー処理

512 MB ガードの撤廃に伴い、ファイルサイズに依存した固定エラー文言を削除する。
Core のエラーは [ADR 0006](0006-structured-error-reporting-for-bag-failures.md) の方針に沿って構造化し、UI 境界で翻訳する。

## Alternatives Considered

- `data: Uint8Array` を残して内部だけ `Blob` にする：どこかで `data` 全体を生成する必要が残るため不採用。
- 全量データと遅延 Reader のユニオン型：パーサーに分岐が増えるため不採用。
  既存の `Uint8Array` も薄い Reader で扱える。
- ROS1 bag を完全にストリーミング処理する：`@foxglove/rosbag` はランダムアクセスを前提とし、大幅な改造が必要なため見送る。
  まず遅延 Reader で全量読み込みを解消する。

## Consequences

- インデックス付きファイルでは入力全体のバッファ確保を避けられ、1 GB 級の bag を扱いやすくなる。
- 読み込み用バッファは処理中の chunk が中心になるが、解析結果の保持やエクスポートにもメモリを使う。
- reindex、外側 zstd 展開、MCAP のフォールバックでは引き続き全量読み込みが発生する。

## Verification / Guardrails

1. `BagSource` に `data: Uint8Array` を再導入しない。
2. `fileToBagSource` はファイル本体の `arrayBuffer()` を呼ばず、`file.slice(...).arrayBuffer()` を使う。
3. 全量読み出しは上記の例外パスに限定し、新規追加時は ADR または実装コメントに理由を残す。
4. ADR 0008 の Core/Web 境界条件（Core から DOM API を参照しないなど）を維持する。
5. 数百 MB から 1 GB 級のインデックス付き bag で読み込み完了を確認する（自動 E2E は小さな fixture でよい）。
