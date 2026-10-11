# ADR: 未インデックス bag をブラウザ上で reindex する

- Status: Accepted
- Date: 2026-03-28

## Context

ROS の録画中にプロセスが強制終了すると、ファイル末尾が不完全になることがある。
ROS1 bag ではインデックスが書き込まれず、`@foxglove/rosbag` で読めないため、従来は `rosbag reindex` による事前修復が必要だった。
ROS2 MCAP は、既存のストリーミング読み取りへのフォールバックで対処する。

本ツールは offline-first のブラウザアプリであり、外部 CLI やサーバーサイドでの処理を前提にできない。
ROS1 bag もブラウザ上でインデックスを再構築する必要がある。

## Decision

ROS1 の未インデックス bag を検出した場合、ブラウザ上でバイナリレベルの reindex を実行し、再構築したデータを `@foxglove/rosbag` で読み直す。

## Decision Details

- bag ヘッダの `indexPosition === 0 && connectionCount === 0 && chunkCount === 0` により未インデックス状態を判定する。
- `reindexUtils.ts` がチャンクを走査し、`IndexData`、`Connection`、`ChunkInfo` レコードをバイナリレベルで再構築する。
- reindex 処理モジュールは動的 import（`import()`）により遅延ロードし、通常の読み込み経路のバンドルサイズに影響を与えないようにする。
- reindex 完了後は不要となったバッファ参照を解放し、メモリ消費を抑制する。
- 再構築後の bag はダウンロード可能とし、次回以降の読み込みを高速化できるようにする。

## Alternatives Considered

- `rosbag reindex` の事前実行：ROS 環境のない利用者にも対応するため不採用。
- サーバー側での処理：バックエンドを持たない方針と、ログデータのプライバシーを守るため不採用。
- ストリーミング読み取りの独自実装：新規パーサーの保守を避け、再構築したインデックスを既存ライブラリに渡す方式を選ぶ。
- Web Worker：将来の検討対象とする。
  現状はメインスレッドで実行するため、大容量ファイルでは UI が一時停止する。

## Consequences

- ユーザーは未インデックスの ROS1 bag をドラッグ＆ドロップするだけで解析できる。
- 再構築中は元データと生成データを保持するため、メモリ消費が増える。
- ROS1 bag のバイナリ仕様に依存するコードの保守が必要となる。

## Verification / Guardrails

1. `reindexBagFromBuffer` の正常系と各種破損パターンを単体テストで検証する。
2. 再構築した bag を `@foxglove/rosbag` で開くラウンドトリップテストを行う。
3. 未インデックス bag の読み込み、reindex 通知、ダウンロードを E2E テストで検証する。
4. 正常なインデックス付き bag で reindex 処理が発動しないことを検証する。
