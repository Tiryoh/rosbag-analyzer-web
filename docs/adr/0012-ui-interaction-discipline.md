# ADR: UI インタラクション規律(モーション・フォーカス・サーフェス)

- Status: Proposed
- Date: 2026-08-24

## Context

デザイン監査(Hallmark audit)で、UI に以下の系統的な問題が指摘された。

- `transition-all` が多数の要素に付与され、ブラウザ既定の `ease` イージングを含めて全プロパティが一律アニメーションしていた
- 入力欄が `transition-all` + `focus:ring-2` の組み合わせのため、フォーカスリングがフェードインし、キーボードユーザーがフォーカス直後にインジケータを視認できなかった
- `focus-visible` スタイルを持つインタラクティブ要素が 2 つしかなく、他はホバースタイルのみだった
- ほぼ全セクションに入場アニメーション(`animate-fade-in`)が付き、条件レンダリングのためタブ切替やフィルタ適用のたびに再フェードインしていた。`prefers-reduced-motion` への配慮もなかった
- 装飾目的の `backdrop-blur-sm`(グラスモーフィズム)が全カードに付き、大きなテーブルを載せるカードで GPU コストが無駄だった

これらは個別のバグではなく「規律の不在」が原因であり、修正後も新しい UI 追加で再発しやすい。

## Decision

UI のモーション・フォーカス・サーフェスに関する規律を定め、共有コンポーネントクラスとして `src/web/index.css` に集約する。

## Decision Details

1. **トランジションは対象プロパティを明示する。** `transition-all` は禁止。原則 `transition-colors`(color / background-color / border-color 系)のみ。box-shadow はトランジション対象に含めない。
2. **イージングは named easing のみ。** ブラウザ既定の `ease` は使わない。`:root` の `--ease-out`(exponential ease-out 系)/ `--ease-in-out` トークンを参照する。Tailwind の `transition-*` ユーティリティは `tailwind.config.js` の `transitionTimingFunction.DEFAULT` を `var(--ease-out)` にして、個別指定なしでもトークンを通るようにする。
3. **フォーカスリングは `focus-visible` で即時表示する。** リングの出現をアニメーションさせない(規律 1 の box-shadow 除外がこれを保証する)。
4. **全インタラクティブ要素に focus-visible リングを付与する。** ホバースタイルのみの要素を作らない。共有クラス(`.btn-primary` / `.btn-secondary` / `.btn-link` / `.btn-chip` / `.input-field` / ラジオ・チェックボックス用の `.input-check`)を使えば自動的に満たされる。新しいボタン・入力はまず共有クラスを使い、足りない場合のみ拡張する。
5. **入場アニメーションは初回ページロード時の 1 回に限定する。** `animate-fade-in` + `stagger-*` は常時レンダリングされる要素(ヘッダー、アップロードゾーン)にのみ付与する。条件レンダリングされるセクションには付けない(状態変化のたびに再アニメーションするため)。
6. **`prefers-reduced-motion: reduce` では移動を伴うモーションを 150ms 以下の opacity フェードに縮退する。** index.css のメディアクエリで一括対応する。
7. **サーフェスは不透明の実色を使う。** ぼかすべき背景コンテンツが存在しないため `backdrop-blur` は使わない。カードは `.card`(`bg-white dark:bg-surface-900` + border)を使う。
8. **色は `tailwind.config.js` の `brand` / `surface` トークンを使う。** 生の Tailwind パレット(`slate-*` 等)でトークンスケールを迂回しない。

## Alternatives Considered

- **各要素に個別にユーティリティクラスを書き続ける(現状維持)** — focus-visible の付け漏れや `transition-all` の混入をレビューだけで防ぐのは現実的でなく、監査指摘の温床だったため不採用。
- **UI コンポーネントライブラリ(shadcn/ui 等)の導入** — 単一画面のツールに対して依存とファイル数が過大。`@layer components` の共有クラスで十分。
- **React コンポーネント(`<Button variant=...>`)への抽出** — 将来的には有効だが、今回の目的(スタイル規律の一元化)は CSS 層で達成でき、`App.tsx` の構造変更を伴わない分リスクが小さい。コンポーネント抽出時もこの共有クラスをそのまま参照できる。

## Consequences

- 良い影響: キーボード操作の視覚フィードバックが全要素で保証される。タブ切替・フィルタ適用時に画面が再フェードインせず落ち着く。reduced-motion 環境(WCAG 配慮)に対応する。ボタン/入力のスタイルが 1 箇所に集約され、変更コストが下がる。
- 悪い影響: `App.tsx` のクラス文字列と `index.css` の共有クラスの 2 箇所を見ないと最終スタイルが分からなくなる(サイズ系ユーティリティは呼び出し側に残るため)。
- 保守コスト: 新しいインタラクティブ要素を追加する際、共有クラスの存在を知らないと規律から漏れる。本 ADR とレビューで担保する。

## Verification / Guardrails

- `src/web/` に `transition-all` が存在しないこと(`rg 'transition-all' src/web/` が 0 件)
- `backdrop-blur` が存在しないこと
- `animate-fade-in` の付与先が常時レンダリング要素(ヘッダー、アップロードゾーン)のみであること
- `index.css` に `prefers-reduced-motion: reduce` ブロックが存在すること
- 新規ボタン・入力が共有クラス(`.btn-*` / `.input-field` / `.input-check`)経由で focus-visible リングを持つことをレビューで確認する
- `e2e/ui-discipline.spec.ts` で、入場アニメーションの付与先、reduced-motion 時の上書き、代表的な共有クラスのフォーカスリングが即時に出ることを検証する
