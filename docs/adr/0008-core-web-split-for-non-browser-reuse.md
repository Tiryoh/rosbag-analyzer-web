# ADR: Core と Web を分離し、Bag loaders をブラウザ非依存にする

- Status: Accepted (一部は ADR 0009 にて supersede)
- Date: 2026-04-16

> **Update (2026-04-29):** 全量読み込みと 512 MB ガードは、[ADR 0009](0009-lazy-bagsource-via-blob-slice.md) の遅延 Reader に置き換えた。
> Core/Web の分割、スタイル分離、reindex 結果を `Uint8Array` で返す方針は維持する。

## Context

解析ロジックは、`File` 入力、`BlobReader`、DOM によるダウンロード、`DOMException` 判定などのブラウザ固有 API に依存していた。
型定義にもドメイン型と Tailwind クラス文字列が同居していた。

TUI、CLI、Node スクリプトから同じ解析ロジックを使うには、これらの依存を分離する必要がある。
分離しなければ、コードの二重保守、DOM polyfill の導入、環境判定の増加につながる。

## Decision

解析処理を `src/core/`、ブラウザ固有処理と UI を `src/web/` に分離し、両者の依存を `web` → `core` の一方向にする。
Core の入出力からブラウザ固有の型を除き、単一パッケージ内のディレクトリ規約で境界を管理する。

## Decision Details

### 1. `BagSource` と内部 Reader

当初は `BagSource = { name: string; data: Uint8Array }` を入力型とし、`BlobReader` を `Uint8Array` 向けの内部 Reader に置き換える。
`name` は形式判定と診断に使い、`Uint8Array` はバイト範囲の情報を保持して部分配列を扱えるため採用する。
この全量読み込み方式は、後に ADR 0009 で置き換える。

### 2. `fileAdapter.ts` の責務

`src/web/fileAdapter.ts` に以下を集約する。

- `fileToBagSource(file: File)` による入力の変換と、ブラウザ固有の読み取りエラー処理。
- `downloadFile` / `downloadBlob` / `downloadBytes` による、`URL.createObjectURL` とリンククリックを使ったダウンロード。

CSV/JSON/TXT/Parquet の生成は Core に残し、文字列または `Uint8Array` を返す。

### 3. ディレクトリ配置と依存規則

```
src/
  core/         # 解析ロジックとドメイン型（DOM/UI 非依存）
  web/          # UI と DOM アダプタ
  types/        # グローバル型宣言
```

Core から Web、React、DOM API を参照しない（型のみの参照も含む）。

### 4. `types.ts` の分割

- `src/core/types.ts` にドメイン型と定数マッピングを残す。
- `src/web/severityStyles.ts` に Tailwind クラス文字列を移す。

### 5. reindex 結果の返却形式

`ReindexResult.blob: Blob` を `ReindexResult.bytes: Uint8Array` に変更し、ダウンロード時に Web 側で `Blob` に包む。
`reindexBagFromBuffer` は `ArrayBuffer | Uint8Array` を受け取り、既存の呼び出しとの互換性を保ちつつ、部分配列を余分なコピーなしで渡せるようにする。

## Alternatives Considered

- Node 側で `File` の polyfill を使う：実装の環境差と DOM 型への依存が残るため不採用。
- 当初から遅延 Reader を採用する：想定する数百 MB 以下では全量読み込みが許容され、変更を小さく保つため見送った（ADR 0009 で採用）。
- モノレポ化：現状はディレクトリ規約で足り、構成管理コストが増えるため見送る。
  成果物が 3 つに増えるか、Core の npm 公開が必要になった時点で再評価する。
- Tailwind クラスを Core に残す：非ブラウザ環境で不要な UI スタイルが同梱されるため不採用。
- reindex 結果を `Blob` で返す：Core にブラウザ固有型への依存が残るため不採用。

## Consequences

- CLI や Worker から解析ロジックを再利用できる。
- UI スタイルの変更がドメインロジックに影響を与えなくなる。
- import の境界は ESLint で強制していないため、コードレビューで確認する必要がある。

## Verification / Guardrails

1. `src/core/**/*.ts` から `src/web/**`、React、DOM API を参照しない。
2. `loadMessages` などのパース系 API の入力型は `BagSource` のみとする。
3. `ReindexResult` が保持するバイト列は `Uint8Array`（`Blob` ではない）とする。
4. ダウンロード関連処理の利用は `src/web/**` に限定する。
5. `src/core/**/*.test.ts` が DOM polyfill なしで Node 環境（Vitest）で通過する。
