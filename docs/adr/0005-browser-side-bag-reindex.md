# ADR: 未インデックス bag をブラウザ上で reindex する

- Status: Accepted
- Date: 2026-03-28

## Context

ROS1/ROS2 の録画ファイルは、録画中にプロセスがクラッシュしたり強制終了されると、不完全な状態で保存されることがある。

- ROS1 bag: インデックスが書き込まれず `@foxglove/rosbag` で読めない。従来は CLI (`rosbag reindex`) での事前処理が必要だった
- ROS2 MCAP: ファイル末尾が切り詰められる。`@mcap/core` の indexed reader では読めないが、streaming reader でフォールバック可能（ADR-0006 参照）

本ツールは offline-first のブラウザアプリであり、サーバーサイド処理やユーザーに CLI 操作を求めることは設計方針に反する。ROS2 MCAP の破損ファイルは streaming フォールバックで対処済みだが、ROS1 bag にはそのような仕組みがなく、バイナリレベルの reindex が必要だった。

## Decision

ROS1 の未インデックス bag を検出した場合、ブラウザ上でバイナリレベルの reindex を実行し、再構築した bag を `@foxglove/rosbag` で読み直す。ROS2 MCAP は既存の indexed→streaming フォールバックで対処する。

## Decision Details

- bag header の `indexPosition === 0 && connectionCount === 0 && chunkCount === 0` で未インデックスを判定
- `reindexUtils.ts` がチャンクを走査し、`IndexData`・`Connection`・`ChunkInfo` レコードをバイナリレベルで再構築
- reindex 後の bag を `Blob` として保持し、ユーザーがダウンロードできるようにする（次回以降の高速読み込み用）
- reindex モジュールは dynamic import で遅延読み込みし、通常の bag 読み込みパスのバンドルサイズに影響しない
- reindex 完了後、元の `ArrayBuffer` / `BlobReader` / `Bag` を null にしてメモリを解放

## Alternatives Considered

### ユーザーに `rosbag reindex` CLI の実行を求める

不採用。offline-first のブラウザアプリとして、外部ツールへの依存を避ける。ROS 環境がないユーザーも想定する。

### サーバーサイドで reindex する

不採用。バックエンドを持たない設計方針に反する。ユーザーの bag ファイルをサーバーに送信するのはプライバシー上も望ましくない。

### ROS2 MCAP と同様の streaming フォールバックを ROS1 bag にも実装する

不採用。ROS1 bag format は MCAP と異なり、チャンク内のレコードを読むにはチャンク位置を知る必要がある。streaming reader に相当する仕組みを一から実装するよりも、インデックスを再構築して既存の `@foxglove/rosbag` に渡すほうが信頼性が高い。

### Web Worker で reindex する

将来的に検討の余地あり。現状はメインスレッドで同期的に実行しているが、大きな bag では UI がブロックされる。

## Consequences

- ユーザーは未インデックス bag をドラッグ&ドロップするだけで解析できる
- reindex 結果をダウンロードすれば次回以降の読み込みが高速になる
- 大きな bag ファイルではメモリ消費が増加する（元データ + reindex 結果の両方が一時的にメモリ上に存在）
- ROS1 bag format のバイナリ仕様に依存するコードが増える

## Verification / Guardrails

- `reindexBagFromBuffer` の直接ユニットテストで正常系・異常系を検証
- reindex 結果を `@foxglove/rosbag` で開き直す roundtrip テスト
- E2E テストで未インデックス bag の読み込み・reindex 通知・ダウンロードを検証
- 通常のインデックス付き bag で reindex が発動しないことを E2E テストで検証
