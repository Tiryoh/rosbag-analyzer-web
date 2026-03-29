# ADR: SQLite エクスポートを廃止し Parquet に置換する

- Status: Accepted
- Date: 2026-03-27

## Context

当初、エクスポート形式の一つとして SQLite を採用していた。SQL 構文でログを検索できることが利点だった。

しかし実際の利用を考えると、DuckDB が Parquet ファイルを直接 SQL で検索できるため、SQLite の中間フォーマットとしての役割は薄い。Parquet は列指向でファイルサイズが小さく、DuckDB・pandas・polars など多くのツールでネイティブに読める。

## Decision

SQLite エクスポートを削除し、Parquet エクスポートに置換する。

## Decision Details

- `hyparquet-writer` を使用してブラウザ上で Parquet ファイルを生成
- rosout / diagnostics それぞれに Parquet エクスポートを提供
- SQLite 関連の依存（`sql.js`）を削除しバンドルサイズを削減
- README に DuckDB での読み方の例を記載

## Alternatives Considered

### SQLite を残して Parquet を追加

不採用。エクスポート形式が増えすぎる（CSV, JSON, TXT, SQLite, Parquet）。SQLite と Parquet の用途が重複しており、保守コストに見合わない。

### SQLite のみ継続

不採用。Parquet のほうがエコシステムのサポートが広く、ファイルサイズも小さい。DuckDB で SQL 検索もできるため SQLite の優位性がない。

## Consequences

- バンドルサイズ削減（sql.js の wasm バイナリが不要に）
- DuckDB + Parquet で SQL 検索が可能（`SELECT * FROM 'export.parquet' WHERE severity = 'ERROR'`）
- SQLite 形式を期待していたユーザーは DuckDB への移行が必要

## Verification / Guardrails

- Parquet エクスポートの内容を `hyparquet` で読み戻すユニットテストで検証
- E2E テストでダウンロードが正常に発生することを検証
