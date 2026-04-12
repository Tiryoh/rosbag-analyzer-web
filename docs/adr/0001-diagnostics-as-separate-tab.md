# ADR: diagnostics_agg を rosout と独立したタブで表示する

- Status: Accepted
- Date: 2026-02-27

## Context

ROS1 の bag ファイルには `/rosout_agg`（ログメッセージ）と `/diagnostics_agg`（ハードウェア・ソフトウェア診断）の 2 種類の運用情報が含まれることがある。
両者は同じ bag ファイルに同時に記録されるが、含まれる情報の性質が異なる。

- rosout: ノード単位のログメッセージ（severity ベース）
- diagnostics: コンポーネント単位の状態報告（OK/WARN/ERROR/STALE）

当初は rosout のみを表示していたが、diagnostics も同時に確認したいというニーズがある。

## Decision

diagnostics_agg を rosout とは独立したタブとして表示する。フィルタ・エクスポートもタブごとに独立させる。

## Decision Details

- タブ切り替え UI で rosout / diagnostics を分離
- diagnostics は「状態が変化したとき」のみエントリとして表示（全メッセージではなく state change ベース）
- フィルタは rosout のノード・severity フィルタと構造を揃えるが、diagnostics 側は name・level に読み替え
- エクスポート（CSV/JSON/TXT/SQLite）はタブごとに独立
- `/diagnostics_agg` と `/diagnostics` の両方のトピックを対象とする

## Alternatives Considered

### rosout と diagnostics を同一テーブルに混在表示

不採用。rosout は severity ベースのログ、diagnostics は level ベースの状態報告であり、カラム構造が異なる。混在させると表示もエクスポートも複雑になる。

### diagnostics をオプション表示（トグル）

不採用。タブ分離のほうが UI が整理され、フィルタ・エクスポートの独立性も保てる。

## Consequences

- rosout と diagnostics を独立に閲覧・フィルタ・エクスポートできる
- bag ファイルに diagnostics が含まれない場合はタブ自体を非表示にする
- フィルタ UI の実装がタブごとに必要になり、コード量が増える

## Verification / Guardrails

- diagnostics タブは diagnostics トピックが存在する場合のみ表示される
- state change ベースの表示が正しいことを E2E テストで検証
- rosout / diagnostics のエクスポートが互いに干渉しないことをテストで検証
