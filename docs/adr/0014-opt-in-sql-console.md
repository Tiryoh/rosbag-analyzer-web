# ADR: オプトインのブラウザ内 SQL コンソールを LLM ログ Q&A の基盤にする

- Status: Proposed
- Date: 2026-10-12

## Context

このアプリの最優先事項は、バックエンドを持たず、運用の手間を増やさないことである。解析はブラウザ内で完結し、ログを外部へ送らない。

固定のフィルタ（重大度、ノード、キーワード、正規表現、時間範囲）では、見落としやすいパターンを後から探すのが難しい。ログの件数が多いほど、「このノードの ERROR の直後に diagnostics が STALE になったか」のような横断的な問いを、あらかじめ用意したフィルタだけでは表現しきれない。自由形式の SQL なら、読み込んだ rosout と diagnostics をその場で組み合わせて確認できる。

将来は、この SQL を LLM に生成させてログへ質問できるようにしたい。ただし本 ADR の範囲では、ローカル LLM も外部 API も導入しない。問い合わせの実行基盤だけを先に置き、生成や送信は後続の ADR に残す。

関連する既存決定:

- ADR 0003 は、エクスポート形式としての SQLite と `sql.js` を廃止し、Parquet に置換した。外部ツール（DuckDB、pandas、Polars）で SQL 検索できることが理由である。
- ADR 0011 は loader のコンソール出力を 1 ロードあたり一定行数に抑える決定であり、LLM や外部 API には触れていない。

## Decision

将来の LLM ログ Q&A の基盤として、オプトインかつ web 限定の SQL コンソールを追加する。エンジンは `sql.js`（SQLite の WebAssembly ビルド）を使う。`sql.js` は MIT、SQLite 本体はパブリックドメインである。

本 ADR は ADR 0003 を置換しない。ダウンロード用のエクスポートは Parquet のままとする。本 ADR は ADR 0011 を改正も部分置換もしない。

## Decision Details

- 機能フラグは `VITE_ENABLE_LLM=1` のみ有効とする。この値を付けるのは Cloudflare Pages の web デプロイに限る。
- フラグ無しのダウンロード用ビルド（通常の `dist` と `build:singlefile`）からは、SQL コンソールのコード、wasm、ライセンスファイル、SQL 用の i18n 文字列をすべて除く。除外は CI の grep で検証する。
- wasm は CDN から取得せず、`sql.js` の配布物を Vite でバンドルする。パネルを開いたときだけ遅延ロードする。
- インメモリ DB に `rosout` と `diagnostics` の 2 テーブルを作る。列は Parquet エクスポートと同じにする。対象はフィルタ前の全件とする。
- 受け付けるのは単一の `SELECT` / `WITH` のみとし、ブラウザ内で実行する。結果行数には上限を置く。
- この段階では、ログもクエリもブラウザの外へ出さない。
- 同梱物のライセンスは `THIRD_PARTY_LICENSES.md` に記載し、フラグ有効の web ビルドへ同梱する。

## Alternatives Considered

- **DuckDB-WASM** — 不採用。SQL 機能は十分だが、配布バイナリが重く、Cloudflare Pages の 1 ファイル 25MiB 制限に対する余裕が小さい。`sql.js` の wasm は約 658kB で収まる。
- **段階的な JSON フィルタの追加** — 不採用。固定フィルタを増やしても、見落としやすい横断パターンをその場で書く自由度は SQL に届かない。将来の LLM が生成する問い合わせの形としても SQL の方が扱いやすい。
- **バックエンドまたは Cloudflare Worker で SQL を実行する** — 不採用。運用対象と外部送信が発生し、バックエンド無し・ゼロメンテナンスという最優先事項に反する。

## Consequences

### Positive

- web デプロイでのみ、読み込み済みログを自由形式の SQL で確認できる。
- LLM を足す前に、テーブル定義、読み取り専用の実行、結果表示を分離できる。
- ダウンロード用ビルドのサイズとライセンス同梱物は、フラグ無しのとき従来どおりになる。

### Negative

- フラグ有効の web ビルドに、約 658kB の wasm とライセンスファイルが増える。
- `sql.js` と SQLite のライセンス表記を、web ビルドと README で維持する必要がある。
- ADR 0003 で削除した `sql.js` が、エクスポートではなく問い合わせ基盤として戻る。用途が違うことをレビューで混同しない。

### 後続

- 次の ADR / PR で、BYOK の LLM による SQL 生成を追加する。生成結果はユーザーが確認してから実行する。
- その後、Sign in with ChatGPT を検討する。

## Verification / Guardrails

1. `VITE_ENABLE_LLM` 未設定の `npm run build` と `npm run build:singlefile` の成果物に、`sqlite` / `sql.js`、`api.openai.com`、wasm、SQL 用ライセンスファイルが含まれないことを CI の grep で確認する。
2. `VITE_ENABLE_LLM=1` の web ビルドには SQL コンソールとローカルバンドルの wasm が含まれる。wasm は 25MiB 未満である。
3. テーブル列は Parquet エクスポートと同じ順序・名前である。
4. SQL ガードは単一の `SELECT` / `WITH` 以外を拒否する。
5. この段階の実装に LLM クライアントや外部 API 呼び出しを含めない。
