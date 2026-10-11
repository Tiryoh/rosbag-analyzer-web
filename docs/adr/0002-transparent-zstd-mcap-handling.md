# ADR: MCAP .zstd 圧縮を透過的に処理する

- Status: Accepted
- Date: 2026-03-25

## Context

ROS2 の MCAP には、チャンク単位の圧縮に加え、ファイル全体を zstd 圧縮した `.mcap.zstd` 形式がある。
解析前に手動で展開する必要があると、作業の手間とストレージ消費が増える。

## Decision

ファイル全体が zstd 圧縮された MCAP をブラウザ上で展開し、通常の MCAP パーサーに渡す。

## Decision Details

- `loadMessages` は拡張子 `.mcap` / `.mcap.zstd` を MCAP ローダーに振り分ける。
- MCAP ローダーは先頭 4 バイト（`28 b5 2f fd`）で外側の zstd 圧縮を判定し、圧縮されていれば `fzstd` で全体を展開する。
- 外側が zstd 圧縮されていなければ、そのまま MCAP パーサーに渡す。
- MCAP 内部のチャンク圧縮（zstd や lz4）は、`@mcap/core` の `decompressHandlers` で処理する。

## Alternatives Considered

- 手動での事前展開：手間とストレージ消費が増え、ブラウザだけで解析できなくなるため不採用。

## Consequences

- ユーザーは圧縮形式を意識せずにファイルを読み込める。
- ファイル全体の展開処理をメモリ上で行うため、大容量の `.mcap.zstd` ではメモリ消費が増加する。
- `fzstd` ライブラリへの依存が追加される。

## Verification / Guardrails

1. `.mcap` と `.mcap.zstd` の読み込みを E2E テストで検証する。
2. 破損した `.mcap.zstd` に対し、クラッシュせずエラーメッセージを表示することを検証する。
