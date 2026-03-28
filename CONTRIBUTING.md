# Contributing to ROSbag Analyzer

Thank you for your interest in contributing!

## Issue First Policy

**Please open an Issue before submitting a Pull Request.**
This helps us discuss the approach before you invest time writing code.
Feature requests may or may not be accepted — the maintainer will decide on a case-by-case basis.

Exception: trivial fixes such as typos do not require an issue.

## Important: Offline-First

This application is designed to work entirely offline with no backend required. **Changes that break offline functionality will not be accepted.** Please ensure your contribution does not introduce any dependency on external servers or network connectivity at runtime.

## Development Setup

Prerequisites: Node.js 22+ and npm

```bash
git clone https://github.com/Tiryoh/rosbag-analyzer-web.git
cd rosbag-analyzer-web
npm install
npm run dev
```

### Available Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Type-check (`tsc`) and build with Vite |
| `npm run lint` | Run ESLint (zero warnings allowed) |
| `npm run test` | Run unit tests with Vitest |
| `npm run test:e2e` | Run Playwright end-to-end tests |

### Before Submitting a PR

1. Make sure `npm run lint` passes with zero warnings.
2. Make sure `npm run test` passes.
3. Make sure `npm run build` succeeds.

## Pull Request Guidelines

- Reference the related Issue in your PR description (e.g., `Closes #123`).
- Keep changes focused — one PR per issue.
- By submitting a Pull Request, you agree that your contribution will be licensed under the [MIT License](LICENSE).

## Recognition

Contributors may be credited in the README at the maintainer's discretion.

---

# コントリビューションガイド

コントリビューションに興味を持っていただきありがとうございます!

## Issue First ポリシー

**プルリクエストを作成する前に、まず Issue を作成してください。**
コードを書く前に方針を相談することで、スムーズにコミュニケーションを進められます。
機能追加リクエストについては、受け入れるかどうかはメンテナが判断します。

例外: タイポの修正などの軽微な修正は Issue 不要です。

## 重要: オフライン動作の維持

本アプリケーションはバックエンド不要で完全にオフラインで動作するように設計されています。**オフライン動作を損なう変更は受け入れません。** 外部サーバーやネットワーク接続への実行時の依存を導入しないようにしてください。

## 開発環境のセットアップ

前提: Node.js 22+ と npm

```bash
git clone https://github.com/Tiryoh/rosbag-analyzer-web.git
cd rosbag-analyzer-web
npm install
npm run dev
```

### 利用可能なコマンド

| コマンド | 説明 |
|---------|------|
| `npm run dev` | 開発サーバーの起動 |
| `npm run build` | 型チェック (`tsc`) + Vite ビルド |
| `npm run lint` | ESLint の実行 (警告ゼロが必須) |
| `npm run test` | Vitest によるユニットテストの実行 |
| `npm run test:e2e` | Playwright による E2E テストの実行 |

### PR を出す前に

1. `npm run lint` が警告ゼロで通ること。
2. `npm run test` が通ること。
3. `npm run build` が成功すること。

## プルリクエストのガイドライン

- PR の説明に関連する Issue を記載してください (例: `Closes #123`)。
- 変更は1つの Issue につき1つの PR にまとめてください。
- プルリクエストを提出した時点で、その貢献が [MIT ライセンス](LICENSE) のもとで公開されることに同意したものとみなします。

## クレジット

貢献の度合いに応じて、メンテナの判断により README にコントリビューターとしてお名前を掲載することがあります。
