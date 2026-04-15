# ADR: Core と Web を分離し、Bag loaders をブラウザ非依存にする

- Status: Accepted
- Date: 2026-04-16

## Context

本プロジェクトは当初、ブラウザ専用の単一ページアプリとして実装された。
`src/rosbagUtils.ts` / `src/mcapUtils.ts` / `src/reindexUtils.ts` はパース・フィルタ・エクスポートといったドメインロジックを担う一方で、実装上以下のブラウザ固有 API に依存していた。

- `File` オブジェクトを直接受け取る loader signature
- `@foxglove/rosbag/dist/cjs/web/BlobReader` による読み取り
- `Blob` / `URL.createObjectURL` / `document.createElement('a')` を使ったダウンロード
- `DOMException` を直接 `instanceof` で判定する大ファイルエラーハンドリング

将来的に同じ解析ロジックを**非ブラウザ環境**（TUI / CLI / Node スクリプト / Web Worker）から再利用したいという要件がある。特に、ユーザー環境によっては ROS 実機ログや大量の bag を扱う場面があり、ブラウザ UI 以外の利用シナリオが想定される。

この状態のまま TUI を追加すると、以下のいずれかが起こる。

- Core を TUI 用にフォークして二重保守になる
- TUI から import するためだけに `jsdom` 相当の DOM polyfill を Node に持ち込む
- Core に `typeof window !== 'undefined'` 分岐が増え、境界が曖昧になる

いずれも保守コストが恒常的に増える。今のうちに**Core / Web の境界を API 型と物理配置の両面で明確化**しておくことで、将来の再利用コストを下げる。

また、`src/types.ts` は Core の型（`RosoutMessage` 等）と Web の Tailwind クラス文字列（`SEVERITY_COLORS` 等）を同一ファイルに同居させており、型境界が曖昧だった点も合わせて整理する。

## Decision

1. **パース系 API の入力型をブラウザ非依存にする**。`File` ではなく `BagSource = { name: string; data: Uint8Array }` を canonical な入力型とする。
2. **ブラウザ固有の glue は独立モジュールに隔離する**。`File` → `BagSource` 変換、ダウンロードヘルパ、DOMException 処理は `src/web/fileAdapter.ts` が担う。
3. **ソースツリーを物理的に `src/core/` と `src/web/` に分割する**。`core` は DOM / React / Tailwind に依存しない。`web` のみが `core` を import する。
4. **Tailwind クラス文字列は Web 側に移す**。`SEVERITY_COLORS` 等は `src/web/severityStyles.ts` に分離し、`src/core/types.ts` は純粋なドメイン型と定数のみを保持する。
5. **Reindex 結果も Blob ではなく `Uint8Array` を返す**。Blob 化は Web 側の責務にする。

モノレポ化（packages/core, packages/web）は行わない。単一パッケージのままディレクトリ規約で境界を表現する。

## Decision Details

### 1. `BagSource` の形状

```ts
export interface BagSource {
  name: string;       // 形式判定（拡張子）と診断用
  data: Uint8Array;   // 全バイト
}
```

- `data` を `ArrayBuffer` ではなく `Uint8Array` にしたのは、ビュー情報（byteOffset / byteLength）を保持でき、subarray ベースの処理に直接渡しやすいため。
- ストリーミング対応はしない。既存実装もメモリに全量ロードする前提で書かれており、TUI でも同程度のメモリが許容されると想定する。将来必要になった時点で `Filelike` 相当の interface を追加で導入してよい。
- `name` を含めることで、`loadMessages` が拡張子で `.bag` / `.mcap` / `.mcap.zstd` を振り分ける既存挙動を維持する。

### 2. `rosbag` 用の内部 Reader

`BlobReader` の代わりに、`src/core/rosbagUtils.ts` 内で `Uint8ArrayReader` を実装する。`@foxglove/rosbag` の `Filelike` interface（`read(offset, length): Promise<Uint8Array>`, `size(): number`）のみを満たし、Blob / FileReader には触れない。

`src/core/mcapUtils.ts` でも同様に、`BlobReadable` を `Uint8ArrayReadable`（`IReadable` を満たす）に置換する。

### 3. `fileAdapter.ts` の責務

`src/web/fileAdapter.ts` が抱える処理:

- `fileToBagSource(file: File): Promise<BagSource>` — `File.arrayBuffer()` の呼び出しと、512MB 超で `NotReadableError` が出た場合の「メモリ不足」メッセージへのラップ
- `downloadFile(content, filename, type)` / `downloadBlob(blob, filename)` / `downloadBytes(bytes, filename, type?)` — `URL.createObjectURL` ＋ `<a>` クリックのダウンロード

Core には**これらを一切持たない**。Core の export は純粋関数だけで完結する。

### 4. ディレクトリ配置

```
src/
  core/
    rosbagUtils.ts
    mcapUtils.ts
    reindexUtils.ts
    types.ts
    *.test.ts
  web/
    App.tsx
    main.tsx
    i18n.ts
    fileAdapter.ts
    severityStyles.ts
    index.css
    assets/
    *.test.ts
  types/            ← グローバル型宣言（compression.d.ts 等）。core/web 非所属
  vite-env.d.ts     ← 同上
```

- `src/core/**` は `src/web/**` / `react*` / DOM 型（ただし TS の `lib.dom` が暗黙に見える範囲は許容）を import してはいけない
- `src/web/**` は `../core/**` を自由に import してよい
- 逆方向（core → web）は禁止

現時点では ESLint ルールで機械的に強制しないが、`noUnusedLocals` と `tsc` 型チェックで意図しない import はかなり早期に検知できる。

### 5. `types.ts` の分割方針

- 型宣言・ドメイン定数・パース側で使うマッピングは `src/core/types.ts` に残す
  - `SeverityLevel`, `BagSource`, `RosoutMessage`, `DiagnosticStatusEntry`
  - `ROS1_SEVERITY`, `ROS2_SEVERITY`, `SEVERITY_LEVELS`, `DIAGNOSTIC_LEVEL_NAMES`
- Tailwind クラス文字列は `src/web/severityStyles.ts` に移す
  - `SEVERITY_COLORS`, `SEVERITY_BG_COLORS`, `DIAGNOSTIC_LEVEL_COLORS`, `DIAGNOSTIC_LEVEL_BG_COLORS`
- import されていない `FilterConfig` は削除

### 6. Reindex 結果の返却形式

`ReindexResult.blob: Blob` を `ReindexResult.bytes: Uint8Array` に変更する。さらに `reindexBagFromBuffer` は `ArrayBuffer | Uint8Array` の両方を受け付けるようにする（既存の `ArrayBuffer` 渡しのテストを壊さず、新規の Uint8Array 経路では余計なコピーを発生させないため）。

Web 側の「再 index 済み bag をダウンロードする」機能は、ダウンロード直前に `downloadBytes(reindexedBytes, filename)` 経由で Blob に包む。

### 7. 既存挙動の維持

- 空ファイル拒否（`Empty file. The selected file contains no data.`）は `loadMessages` に残す
- 大ファイルの `NotReadableError` ラッピング（`... too large to load into browser memory`）は `fileToBagSource` に移設する。純粋な `loadMessages` はこの分岐を持たない
- CSV/JSON/TXT/Parquet のエクスポート関数は Core に残す（戻り値は string / Uint8Array）

## Alternatives Considered

### Alternative 1: `File` のまま受け取り、Node でも `File` polyfill を使う

不採用。

理由:

- `File` は DOM 仕様の派生で、Node の `undici.File` や `buffer.File` の挙動が環境ごとに微妙に異なる
- polyfill 依存が TUI バイナリの配布物に紛れ込む
- 型的にも `lib.dom` を Core が参照し続ける必要があり、境界がぼやける

### Alternative 2: `Filelike` interface（offset/length の遅延読み）を Core の入力にする

不採用（ただし将来再検討可）。

理由:

- 既存実装が全量ロード前提であり、ストリーミング化には `BagReader` / MCAP 双方の内部変更が必要
- 現状ユースケース（最大数百MB）でメモリが逼迫する兆候はない
- `BagSource` から `Filelike` への移行は後から足せる。今回は必要最小限に留める

### Alternative 3: `packages/core`, `packages/web` のモノレポ化

不採用。

理由:

- 成果物が 2 つ（Web と将来の TUI）でモノレポ化のオーバーヘッドが正当化しにくい
- 単一パッケージ + ディレクトリ規約で目的の 80% は達成できる
- `pnpm` / workspace の導入 / TS project references / eslint 設定の横展開などが一度に降ってくる
- 3 つ目の成果物が出た、または `@rosbag-analyzer/core` を npm 公開したくなった時点でモノレポ化を再評価する

### Alternative 4: `types.ts` はそのままにして Tailwind クラスを Core に残す

不採用。

理由:

- `SeverityLevel` は Core 由来だが、`SEVERITY_COLORS` は Tailwind の class 文字列で、Core からは使われない
- Core を TUI/CLI から import した際に UI 色定義が同梱される
- 片方向の依存（`severityStyles.ts → core/types`）で済むため、分離コストは低い

### Alternative 5: `reindexedBlob` のまま Blob を Core から返す

不採用。

理由:

- `Blob` は DOM 型。Node 18+ にもあるが、仕様・挙動に差がある
- Core が `Blob` を返すことで Core → DOM への型依存が再発する
- 呼び出し側で `new Blob([bytes])` するコストは無視できる

## Consequences

### Positive

- Core が `File` / `Blob` / `document` / `URL` / `BlobReader` に依存しなくなる
- Core を TUI / CLI / Worker から**追加実装なしで**再利用可能
- `src/core/` と `src/web/` の責務が一目でわかる
- `types.ts` の混在が解消され、Tailwind 変更は UI だけの関心事になる
- Reindex 済み bag の持ち回りが `Uint8Array` になり、Node ファイルシステムに直接 `fs.writeFile` で書ける

### Negative

- `App.tsx` の import 行が `core/` と `./` の 2 系統に増える
- `File` → `Uint8Array` 変換のため、ブラウザ側で一回メモリコピーが増える（現状の `File.arrayBuffer()` はもともと全量コピー相当なので実質変わらない）
- Core 内で `Blob` を使わないため、巨大ファイルの lazy read 最適化は現状できない
- 境界違反（core が web を import する）は ESLint で機械的に止めていない。レビューでのチェックに依存する

### Operational Impact

- 新規 Core モジュールは `src/core/` 以下に置く
- 新規 UI モジュールは `src/web/` 以下に置く
- `core` 側の実装は「DOM API を直接呼ばない」「Blob / URL / document を触らない」という規律を守る
- AGENTS.md と `.github/copilot-instructions.md` で新規参加者・エージェントに境界を明示する
- 将来 TUI を追加する場合は `src/tui/` または独立パッケージを追加し、`core` のみを import する

## Verification / Guardrails

実装後に以下を不変条件として維持する。

1. `src/core/**/*.ts` は `react`, `react-dom`, `./web/*`, `../web/*` を import しない
2. `src/core/**/*.ts` は `File`, `Blob`, `document`, `URL.createObjectURL`, `FileReader`, `DOMException` を実装内で参照しない（型だけのリファレンスも避ける）
3. `loadMessages` / `loadRosbagMessages` / `loadMcapMessages` の入力型は `BagSource` のみ
4. `ReindexResult` が返すバイト列は `Uint8Array`（`Blob` ではない）
5. `fileToBagSource` 以外の場所で `File.arrayBuffer()` を呼ばない
6. `downloadBlob` / `downloadFile` / `downloadBytes` の利用は `src/web/**` に限定する
7. Core のユニットテスト（`src/core/**/*.test.ts`）は Node 実行（`vitest run`）で DOM polyfill を要求せずに通る
8. ブラウザ側の挙動（空ファイル拒否、大ファイルの `NotReadableError` メッセージ、再 index 済み bag のダウンロード）は従来通り動く

## Notes

この ADR は、当初の目的である「TUI / CLI を後から低コストで追加可能にする」を達成するための基盤整備として位置付ける。実際の TUI 実装、シングルバイナリ化方針（Node SEA / Bun `--compile` など）、モノレポ化の可否は別 ADR で扱う。
