# ADR: diagnostics_agg を rosout と独立したタブで表示する

- Status: Accepted
- Date: 2026-02-27

## Context

ROS1 の bag には、性質の異なる 2 種類の運用情報が記録されることがある。

- **rosout**：ノード単位のログ（`/rosout_agg`、severity ベース）
- **diagnostics**：コンポーネント単位の状態報告（`/diagnostics_agg`、OK/WARN/ERROR/STALE）

当初は rosout のみを表示していたが、diagnostics も同時に確認したいという要件が生じた。

## Decision

diagnostics を rosout とは独立したタブに表示し、フィルタとエクスポートも分離する。

## Decision Details

- diagnostics は全メッセージではなく、状態が変化した時点のみをエントリとして表示する。
- フィルタ構成は rosout 側（ノード、severity）と揃え、diagnostics 側はコンポーネント名および level に対応付ける。
- エクスポート（CSV、JSON、TXT、Parquet）はタブごとに独立して実行する。
- `/diagnostics_agg` と `/diagnostics` の両トピックを対象とする。

## Alternatives Considered

- 同一テーブルへの混在表示：カラム構造が異なり、表示とエクスポートが複雑になるため不採用。
- トグルによるオプション表示：タブのほうがフィルタとエクスポートの独立性を保ちやすいため不採用。

## Consequences

- rosout と diagnostics を独立して閲覧、フィルタ、エクスポートできる。
- diagnostics トピックがない場合はタブを非表示にする。
- タブごとにフィルタ UI と状態管理の実装が必要となる。

## Verification / Guardrails

1. diagnostics トピックが存在する場合にのみ diagnostics タブが表示される。
2. 状態変化ベースの表示を E2E テストで検証する。
3. 両タブのエクスポートが互いに干渉しないことをテストで検証する。
