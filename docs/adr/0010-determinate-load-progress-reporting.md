# ADR: Bag ロードの進捗をフェーズ + ソースレコード件数で報告する

- Status: Proposed
- Date: 2026-06-19

## Context

これまでのロード中 UI は、進捗量を持たない不定形のアニメーション（`loading-bar`）だけだった。
ADR 0009 で `Blob.slice` ベースの遅延ロードに切り替え、数百 MB 〜 1 GB クラスの bag を開けるようになった結果、ロードに数秒〜数十秒かかるケースが現実的になり、「どれくらい進んでいるか」「フリーズしていないか」をユーザーに示す必要が出てきた。

当初のラフ案（作業メモ）は「`chunkInfos` の chunk index / chunk total で割合を出す」というものだったが、実装に入ると次の問題が見えた。

- ROS1 (`@foxglove/rosbag`) と MCAP (`@mcap/core`) で chunk の概念・取得 API が揃っておらず、共通の「chunk index」を loader 横断で安定して取り出せない
- `readMessages` のコールバックは同期実行で、その中から chunk 境界を厳密に追うのは困難
- reindex / 外側 zstd 解凍 / unchunked MCAP の streaming fallback など、そもそも chunk 単位の進捗が原理的に取れない経路がある（ADR 0009 Decision Details §3）

一方で、`@mcap/core` の indexed reader は `statistics.channelMessageCounts` から「対象チャンネルの総メッセージ数」を取得でき、`readMessages` で実際に処理した件数と突き合わせれば確定的な割合を出せる。ROS1 にはこれに相当する事前カウントが無い。

つまり「全 loader で必ず割合を出す」ことはできないが、「出せる経路では確定的な割合を出し、出せない経路では件数だけ出す」ことはできる。

## Decision

進捗は **フェーズ名 + ソースレコード件数** で報告する。chunk index ベースの割合は採用しない。

loader (`loadMessages` / `loadRosbagMessages` / `loadMcapMessages`) に任意の `onProgress?: ProgressCallback` を追加し、次の型を emit する。

```ts
export type LoadPhase = 'open' | 'reindex' | 'rosout' | 'diagnostics';

export interface ProgressInfo {
  phase: LoadPhase;
  messageCount: number;   // UI が最終的に見る行数（rosout push / diagnostics の状態変化エントリ）
  processed?: number;     // ソースレコードの処理済み件数（割合の分子）
  total?: number;         // ソースレコードの総件数（割合の分母）
  fileSize: number;
}

export type ProgressCallback = (info: ProgressInfo) => void;
```

`processed` / `total` は **確定的な割合を出せる経路でのみ** 値を持ち、出せない経路では `undefined` とする。UI は両方が揃っているときだけ確定プログレスバー（`processed / total`）を描画し、欠けているときは従来の不定形アニメーションにフォールバックする。

## Decision Details

### 1. フェーズ

- `open` — ファイルを開いてヘッダを読む段階。loader 冒頭で即時 emit し、UI が直ちに反応を示せるようにする
- `reindex` — ROS1 の未 index bag を materialize → 再構築する段階（ADR 0009 §3 の fallback パス限定）。重い同期スキャンの **前** に emit する
- `rosout` — rosout トピックの読み出し
- `diagnostics` — diagnostics トピックの読み出し（状態変化エントリのみ収集）

### 2. `messageCount` の意味はフェーズ依存

- `rosout` フェーズ: 収集済み rosout メッセージ数（`messages.length`）
- `diagnostics` フェーズ: 収集済み状態変化エントリ数（`diagnostics.length`）
- `open` / `reindex`: 0

「ソースレコード件数 (`processed`)」と「UI が見る行数 (`messageCount`)」は別物である点に注意。diagnostics は状態変化のみを行にするため、`messageCount <= processed` になりうる。

### 3. `processed` / `total` を出せる経路・出せない経路

- **出せる（確定割合）**: MCAP の indexed reader。`statistics.channelMessageCounts` のうち rosout / diagnostics スキーマを持つチャンネルだけを合算して `total` を作り、`readMessages` をそのチャンネルに絞って読むことで `processed <= total` を保証する。`total` が `Number.MAX_SAFE_INTEGER` を超える場合は `undefined` にフォールバックする
- **出せない（件数のみ）**:
  - ROS1 bag 全般（事前総数カウントが無い）
  - MCAP の streaming fallback（unchunked MCAP。総数が事前に分からない）
  - `.mcap.zstd` の解凍中（`open` フェーズの再 emit のみ）

### 4. throttling とイベントループへの yield

- 進捗 emit はメッセージ 100 件ごとに間引く（`shouldEmit(counter, 100)`）。毎メッセージ emit は React の再描画を過剰に誘発する
- `readMessages` の同期コールバック内からは `await` できないため、yield はフェーズ境界（rosout→diagnostics、reindex 前）と MCAP indexed の emit 直後に `yieldToEventLoop()` で行い、React が進捗 state を flush できるようにする
- `yieldToEventLoop` は `setTimeout(_, 0)` で実装する。`requestAnimationFrame` は **使わない** — `src/core/` はブラウザ外でも動く必要があり（ADR 0008）、DOM API に依存させないため

### 5. core / web 境界

- `progressUtils.ts`（`yieldToEventLoop` / `shouldEmit`）は `src/core/` に置く。DOM 非依存なので core の制約に反しない
- UI 文言（フェーズ名・"N messages parsed"）は `src/web/i18n.ts` の `progress.*` キーで管理し、ADR 0006 の方針に沿って web 境界で翻訳する。core 側は翻訳済み文字列を持たない

## Alternatives Considered

### Alternative 1: chunk index / chunk total で割合を出す（当初案）

不採用。
ROS1 と MCAP で chunk 概念・取得 API が揃わず、loader 横断で安定した割合を出せない。reindex / streaming fallback など chunk 進捗が原理的に取れない経路もある。MCAP の `statistics` ベースのレコード件数の方が、確定割合を出せる経路で正確かつ実装が単純。

### Alternative 2: 常に件数だけを出し、割合は一切出さない

不採用。
MCAP indexed では確定割合を安価に出せるのに、それを捨てるのは UX 上もったいない。「出せる経路では出す」を `processed?` / `total?` の optional で表現すれば、出せない経路を件数フォールバックに退避させつつ両立できる。

### Alternative 3: ファイル読み出し（バイト）進捗を出す

不採用（将来再検討可）。
`Blob.slice().arrayBuffer()` の遅延読みはパース側が随時呼ぶため、バイト進捗を取るには `ReadableStream` への切り替えが必要で影響範囲が大きい。本 ADR のレコード件数ベースで「進んでいる感」は十分得られる。

## Consequences

### Positive

- 大きい bag でも、フェーズ名と件数（MCAP indexed では割合も）で進行状況が見える
- `processed?` / `total?` を optional にしたことで、確定割合を出せない loader を壊さずに同じ型へ統一できた
- `onProgress` は optional なので、既存の呼び出し元（テスト含む）に影響しない
- `progressUtils` が DOM 非依存のため core/web 分離（ADR 0008）を維持する

### Negative

- `messageCount` の意味がフェーズによって変わる（rosout 件数 / diagnostics 状態変化件数）ため、消費側はフェーズを見て解釈する必要がある
- loader 内に進捗 emit と yield 呼び出しが点在し、パースのホットパスにわずかなオーバーヘッドが乗る（100 件間引きで実質無視できる範囲）

### Operational Impact

- 新しい loader を追加する場合、`onProgress` を受け取り、最低限 `open` と読み出しフェーズを emit する。確定割合を安価に出せるなら `processed` / `total` も付ける（出せないなら undefined のまま）
- フェーズを増やす場合は `LoadPhase` と `i18n` の `progress.phase.*` を同時に追加する

## Verification / Guardrails

1. `ProgressInfo.processed` / `total` は「ソースレコード件数」であり、`processed <= total` を常に満たす。MCAP indexed では対象チャンネルに絞って読むことでこれを保証する
2. 確定割合を出せない経路（ROS1 / streaming fallback / zstd 解凍）は `processed` / `total` を `undefined` のままにする。UI はその場合に不定形アニメーションへフォールバックする
3. `src/core/**` は進捗報告のために DOM API（`requestAnimationFrame` 等）を参照しない。yield は `setTimeout(_, 0)` で行う
4. `onProgress` は optional で、未指定でもロード結果は変わらない
5. テスト: ROS1 で `open → rosout` が emit され `messageCount` が単調非減少であること、未 index bag で `reindex` が emit されること、indexed MCAP で `processed <= total` を満たす確定イベントが出ること、rosout/diagnostics の無い MCAP（streaming fallback）でも emit されることを確認する
