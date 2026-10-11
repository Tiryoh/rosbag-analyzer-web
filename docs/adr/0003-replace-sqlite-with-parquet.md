# ADR: SQLite エクスポートを廃止し Parquet に置換する

- Status: Accepted
- Date: 2026-03-27

## Context

当初はログを SQL で検索できるように SQLite エクスポートを提供していた。
しかし、DuckDB では Parquet を直接 SQL で検索できるため、中間形式としての SQLite を省ける。
Parquet は列指向でファイルサイズを抑えられ、pandas や Polars でも扱える。

## Decision

SQLite エクスポートを廃止し、Parquet エクスポートへ置換する。

## Decision Details

- `hyparquet-writer` を使用し、ブラウザ上で Parquet ファイルを生成する。
- rosout および diagnostics の双方で Parquet 出力を提供する。
- SQLite 用の `sql.js` 依存を削除する。
- README に DuckDB での読み取り例を記載する。

## Alternatives Considered

- SQLite と Parquet の併存：用途が重複し、並行して保守するコストに見合わないため不採用。
- SQLite のみ継続：SQL 検索を維持しつつ、ファイルサイズと分析ツールへの対応を改善できる Parquet を選ぶ。

## Consequences

- `sql.js` の WebAssembly バイナリが不要になり、アプリのバンドルサイズが縮小する。
- 出力ファイルを DuckDB で直接 SQL 検索できる。
- SQLite 出力を前提とするワークフローは移行が必要になる。

## Verification / Guardrails

1. Parquet 出力を `hyparquet` で読み戻し、内容をユニットテストで検証する。
2. Parquet ファイルのダウンロードを E2E テストで検証する。
