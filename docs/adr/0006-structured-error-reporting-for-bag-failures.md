# ADR: bag ファイルの読み込み失敗時に原因別の構造化エラーを表示する

- Status: Accepted
- Date: 2026-03-28

## Context

読み込み失敗には、末尾の切り詰め、圧縮データやレコードの破損、未対応の圧縮形式、空ファイルなどの原因がある。
「読み込めません」という一律の表示では、部分復旧や別ツールでの修復を試せるか判断できない。

## Decision

読み込み失敗時に、原因別の構造化されたエラー情報を UI に提示する。
部分復旧できた場合は読み取れた範囲を表示しつつ、未復旧箇所の原因を警告として通知する。

## Decision Details

### 1. 失敗状態の分類

- **空ファイル**：サイズ 0 の場合、即座にエラーとする。
- **reindex 失敗**：読取可能チャンクが 0 件の場合、`ReindexFailureError` に阻害要因（blockers）を格納して通知する。
- **reindex 部分成功**：読み取れない部分が残る場合、復旧結果に `ReindexMeta.partial = true` と警告一覧を添える。

512 MB 超の `NotReadableError` にファイルサイズを添える旧処理は、[ADR 0009](0009-lazy-bagsource-via-blob-slice.md) で撤廃した。

### 2. 警告コード体系

| コード | 意味 |
|---|---|
| `truncated-tail` | ファイル末尾の切り詰め |
| `chunk-decompress-failed` | チャンク展開の失敗 |
| `unsupported-compression` | 未対応の圧縮形式 |
| `chunk-record-corrupt` | チャンク内レコードの構造破損 |

[ADR 0007](0007-reindex-warning-classification.md) で、接続メタデータ欠損の警告を追加する。

### 3. UI 表示とエラー伝播

- 完全失敗時はエラーパネルに阻害要因一覧を表示する。
- 部分成功時は amber のバナーに復旧概要と展開可能な警告一覧を表示し、完全成功時は emerald のバナーを表示する。
- `TruncatedRecordError` や `ReindexFailureError` で原因を伝え、UI は `isReindexFailureLike` で構造を判定する。

## Alternatives Considered

- 一律のメッセージ：原因に応じた対処を判断できないため不採用。
- エラーコードのみ：コードだけでは意味が伝わらず、多言語化した説明が必要なため不採用。
- 文字列メッセージによる伝播：文言変更でエラー判定やテストが壊れるため不採用。

## Consequences

- ユーザーは失敗原因を把握し、データの取り扱い方針を判断できる。
- エラー型や警告コードの追加に伴い、UI 表示と型定義の保守コストが発生する。

## Verification / Guardrails

1. 各警告コードの発生と、`ReindexFailureError` の阻害要因を単体テストで検証する。
2. 破損 bag のエラーパネルと警告表示を E2E テストで検証する。
3. 警告コードを追加した際の分岐漏れを、`assertNever` による網羅性チェックで検出する。
