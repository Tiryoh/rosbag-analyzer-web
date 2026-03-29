# ADR: bag ファイルの読み込み失敗時に原因別の構造化エラーを表示する

- Status: Accepted
- Date: 2026-03-28

## Context

bag ファイルが壊れる原因は多様である。

- 録画中のクラッシュによるファイル末尾の切り詰め
- チャンクの圧縮データ破損
- 未対応の圧縮形式
- チャンク内レコードの構造破損
- ファイルサイズが大きすぎてブラウザのメモリに載らない
- ファイルが空（0 バイト）

従来は「壊れています」「読み込めません」という一律のエラーメッセージを表示していた。しかし、原因がわからなければユーザーはそのデータを今後どう扱うべきか判断できない。部分的に復旧可能なのか、別のツールで修復すべきか、データとして諦めるべきかは、失敗の原因によって異なる。

## Decision

bag ファイルの読み込み失敗時に、原因別の構造化されたエラー情報を UI に表示する。部分的に読めた場合は読めた範囲を表示しつつ、読めなかった部分の原因を warning として提示する。

## Decision Details

### エラーの分類

- **空ファイル**: ファイルサイズ 0 の場合、即座にエラー
- **大ファイル読み込み失敗**: `DOMException(NotReadableError)` かつ 512MB 超の場合、ファイルサイズを含むエラーメッセージ
- **reindex 完全失敗**: 読めるチャンクが 0 の場合、`ReindexFailureError` で原因（blockers）を構造化して伝播
- **reindex 部分成功**: 一部チャンクが読めた場合、`ReindexMeta.partial = true` + `warnings` で原因を分類表示

### Warning コード体系

| コード | 意味 |
|--------|------|
| `truncated-tail` | ファイル末尾の切り詰め |
| `chunk-decompress-failed` | チャンク圧縮データの展開失敗 |
| `unsupported-compression` | 未対応の圧縮形式 |
| `chunk-record-corrupt` | チャンク内レコードの構造破損 |

### UI 表示

- 完全失敗時: エラーパネルに blockers リストを表示
- 部分成功時: amber 色の通知バナーに復旧サマリ + 詳細展開可能な warning リスト
- 完全成功時: emerald 色の通知バナー

### エラー伝播

- `TruncatedRecordError` / `ReindexFailureError` カスタムエラークラスで型安全に伝播
- `isReindexFailureLike` 構造的型ガードで UI 側でエラーを分類
- reindex 以外のエラーには `Failed to reindex bag file: ...` のコンテキストを付与

## Alternatives Considered

### 一律のエラーメッセージ

不採用。ユーザーがデータの今後の扱いを判断できない。「壊れています」だけでは、部分復旧可能なのか、修復ツールで直せるのか、完全に失われたのかがわからない。

### エラーコードのみ（詳細なし）

不採用。コードだけでは技術者以外に伝わらない。i18n 対応のラベル + 詳細テキストの組み合わせが必要。

### 全エラーを文字列メッセージで伝播

不採用。文字列マッチによるエラー判定は脆弱。メッセージ変更でテストや UI ロジックが壊れる。

## Consequences

- ユーザーはエラーの原因を把握し、データの扱いを判断できる
- Warning コード追加時は `assertNever` の exhaustive check により、UI・i18n・テストの更新漏れがコンパイル時に検出される
- Warning の種類が増えると UI の複雑さが増す
- カスタムエラークラスと型ガードの保守コストが発生する

## Verification / Guardrails

- 各 warning コードに対応するユニットテスト
- `ReindexFailureError` の blockers プロパティを検証するテスト
- E2E テストで truncated bag のエラー表示と blocker 表示を検証
- `assertNever` による exhaustive check で warning コード追加時の漏れを防止
