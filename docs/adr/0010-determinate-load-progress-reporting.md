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
  - `total` の母集団は「絞り込み対象チャンネル」であって「読み出したレコード」ではない。`readMessages` の filter は topic 単位なので、同じ topic を共有する非対象チャンネルのレコードも流れてくる。`processed` はチャンネル ID で対象を判定して数える
  - 対象チャンネルが 1 つも無い場合は絞り込み自体が成立せず（全チャンネルを読むことになる）、`statistics` を持たない indexed MCAP も同様に分母が無い。どちらも `processed` / `total` を `undefined` のままにする
  - この topic 絞り込みは streaming fallback の判定条件と干渉する点に注意する。fallback は「indexed reader が Message レコードを 1 件も読めない（unchunked MCAP 等）」場合に限り発火させたいが、絞り込み後の読み出しが 0 件になるのは「rosout/diagnostics チャンネルが空の正常なファイル」でも起きる。これを取り違えると ADR 0009 で回避したはずの全量 materialize + 再パースが不要に走る。したがって **絞り込み読み出しが 0 件だったときのみ、未絞り込みで 1 件だけ probe** して両者を判別する（probe のコストは最大 1 chunk の展開で、空の場合にしか発生しない）
- **出せない（件数のみ）**:
  - ROS1 bag 全般（事前総数カウントが無い）
  - MCAP の streaming fallback（unchunked MCAP。総数が事前に分からない）
  - `.mcap.zstd` の解凍中（`open` フェーズの再 emit のみ）

### 4. throttling とイベントループへの yield

- 進捗 emit は **経過時間** で間引く（`createProgressThrottle(intervalMs)`、既定 50ms = 秒 20 回）。毎メッセージ emit は React の再描画を過剰に誘発する
  - **件数ベース（「N レコードごと」）は採らない。** yield 1 回は `setTimeout` のクランプで実測 約 2ms かかるので、件数ベースだと yield 回数がファイルサイズに線形に増える。50 万件の MCAP では、約 14 秒のロードのうち 11 秒が timer 待ちだった。時間ベースなら yield 回数は「経過時間 ÷ interval」で頭打ちになり、ファイルサイズに依存しない（同一ファイルで進捗レポートのオーバーヘッド +10.9 秒 → +0.55 秒、emit 5,054 回 → 42 回）
  - 代償として `Date.now()` を毎レコード呼ぶ。50 万件で約 40ms（ロード全体の 1.5%）なので許容する。カウンタで先に間引く 2 段構えは、この数字が問題になるまで持ち込まない
- throttle は interval 内に来た更新を落とすため、**各読み出しループの終了直後に必ず最終 emit を行う**。これがないと最後に throttle を通過した時点の件数で止まり、1 interval 未満で終わるファイルでは 0 のままになる
- `readMessages` の同期コールバック内からは `await` できないため、yield はフェーズ境界（rosout→diagnostics、reindex 前）と MCAP indexed の emit 直後に `yieldToEventLoop()` で行い、React が進捗 state を flush できるようにする
- `yieldToEventLoop` は `setTimeout(_, 0)` で実装する。`requestAnimationFrame` は **使わない** — `src/core/` はブラウザ外でも動く必要があり（ADR 0008）、DOM API に依存させないため

### 5. core / web 境界

- `progressUtils.ts`（`yieldToEventLoop` / `createProgressThrottle`）は `src/core/` に置く。DOM 非依存なので core の制約に反しない
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
- loader 内に進捗 emit と yield 呼び出しが点在し、パースのホットパスにオーバーヘッドが乗る。50 万件の MCAP で実測 +0.55 秒（ロード時間の約 23%）。内訳は 42 回の yield と毎レコードの `Date.now()`。interval を上げれば減らせるが、バーの滑らかさとのトレードオフになる
- throttle が状態を持つようになったため、読み出しループごとに `createProgressThrottle()` を作る必要がある。使い回すとループ間で interval が引き継がれ、後続ループの最初の emit が落ちる

### Operational Impact

- 新しい loader を追加する場合、`onProgress` を受け取り、最低限 `open` と読み出しフェーズを emit する。確定割合を安価に出せるなら `processed` / `total` も付ける（出せないなら undefined のまま）
- フェーズを増やす場合は `LoadPhase` と `i18n` の `progress.phase.*` を同時に追加する

## Verification / Guardrails

1. `ProgressInfo.processed` / `total` は「ソースレコード件数」であり、`processed <= total` を常に満たす。MCAP indexed では対象チャンネルに絞って読み、対象チャンネルのレコードだけを数えることでこれを保証する
2. 確定割合を出せない経路（ROS1 / streaming fallback / zstd 解凍 / 分母を作れない indexed MCAP）は `processed` / `total` を `undefined` のままにする。UI はその場合に不定形アニメーションへフォールバックする。`processed` だけ・`total` だけを持つ中途半端なイベントは出さない
3. indexed で確定イベントを emit したあと streaming fallback に落ちる場合は、`readStreaming` に入る前に `processed` / `total` を持たないイベントを 1 回 emit して yield する。`readStreaming` は同期実行で途中 yield できないため、これが無いと直前の確定イベント（多くは 0%）のまま画面が固まる
4. `src/core/**` は進捗報告のために DOM API（`requestAnimationFrame` 等）を参照しない。yield は `setTimeout(_, 0)` で行う
5. `onProgress` は optional で、未指定でもロード結果は変わらない
6. 各読み出しループの直後に最終 emit があること。1 interval 未満で終わるファイルでも最終件数が UI に届く
7. 進捗 emit の回数はレコード数ではなく経過時間で決まること。同じ内容でレコード数だけが N 倍のファイルを読んでも emit 回数は N 倍にならない
8. streaming fallback は「indexed reader が 1 件も読めない」場合のみ発火する。topic 絞り込みの結果 0 件になったケースを fallback 条件に直結させない
9. `phase` と `messageCount` は常に対になる。streaming fallback でも読んでいるチャンネルの種別から `phase` を決め、その種別の収集件数（`messages.length` / `diagnostics.length`）を報告する。両者を混ぜた合計件数は出さない
10. テスト: ROS1 で `open → rosout` が emit され `messageCount` が単調非減少であること、未 index bag で `reindex` が emit されること、indexed MCAP で `processed <= total` を満たす確定イベントが出ること、rosout/diagnostics の無い MCAP でも emit されること、1 interval 未満で終わるファイルで最終件数が emit されることを確認する。加えて、`processed` を伴うイベントが必ず `total` を持つこと、statistics を持たない indexed MCAP が不定形のままであること、unchunked MCAP で fallback 前に確定状態が解除されること、diagnostics のみの unchunked MCAP が `phase: 'diagnostics'` を報告すること、`createProgressThrottle` が呼び出し回数ではなく経過時間で発火することを回帰テストで固定する
