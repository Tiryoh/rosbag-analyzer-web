# ADR: MCAP .zstd 圧縮を透過的に処理する

- Status: Accepted
- Date: 2026-03-25

## Context

ROS2 では記録フォーマットとして MCAP が標準的に使われる。MCAP ファイルは内部的にチャンク単位の圧縮（zstd, lz4 など）をサポートしているが、実運用ではファイル全体をさらに zstd で圧縮した `.mcap.zstd` 形式で保存・転送されることが多い。

ユーザーがファイルを解析する前にいちいち手動で展開するのは、ストレージ・時間・計算量の面で無駄が大きい。

## Decision

`.mcap.zstd` ファイルをアップロードされた時点でブラウザ上で zstd 展開し、展開後のバイト列を通常の MCAP パーサーに渡す。ユーザーからは `.mcap` と `.mcap.zstd` の区別を意識する必要がない。

## Decision Details

- ファイル拡張子 `.mcap.zstd` を検出した場合、`fzstd` ライブラリでファイル全体を展開してから MCAP パーサーに渡す
- `.mcap` ファイルはそのまま MCAP パーサーに渡す
- MCAP 内部のチャンク圧縮（zstd, lz4）は `@mcap/core` の decompressHandlers で別途処理
- ファイル形式の判定は拡張子ベース（マジックバイト判定ではない）

## Alternatives Considered

### ユーザーに事前展開を求める

不採用。ストレージ消費が増え、手間もかかる。offline-first ツールとして、アップロードするだけで解析できるべき。

### マジックバイトで自動判定

部分的に採用の余地あり。現状は拡張子ベースだが、zstd マジック (`28 b5 2f fd`) での判定も将来的には有用。現時点では拡張子で十分機能している。

## Consequences

- ユーザーは `.mcap` と `.mcap.zstd` を区別せずにドラッグ&ドロップできる
- ファイル全体の zstd 展開がメモリ上で行われるため、大きな `.mcap.zstd` ファイルではメモリ消費が増加する
- `fzstd` ライブラリへの依存が追加される

## Verification / Guardrails

- `.mcap` と `.mcap.zstd` の両方を E2E テストで検証
- 破損した `.mcap.zstd` ファイルに対してクラッシュせず適切なエラーメッセージを表示することを検証
