# AGENTS.md

This file provides guidance to coding agents working with code in this repository.

## Project Overview

Browser-based ROS1/ROS2 bag analyzer. Parses `.bag` files (ROS1) and `.mcap`/`.mcap.zstd` files (ROS2) entirely client-side. No backend required. Deployed to Cloudflare Pages.

## Development Environment

Two ways to set up the dev environment:

- **Nix users**: `nix develop` provides Node.js 22 pinned via `flake.lock`.
- **mise users**: `mise install` provides Node.js 22 and [aube](https://aube.en.dev) (a fast Node.js package manager) pinned via `mise.toml`.

`aube` is optional — it's `package-lock.json`-compatible, so `npm` works equally well. Use whichever you prefer.

## Commands

Substitute `aube` for `npm` if you have it installed.

- `npm install` — Install dependencies
- `npm run dev` — Start dev server
- `npm run build` — Type-check with `tsc` then build with Vite
- `npm run lint` — ESLint (zero warnings allowed)
- `npm run test` — Run tests with Vitest
- `npm run test:e2e` — Run Playwright end-to-end tests
- `npm run test -- src/core/rosbagUtils.test.ts` — Run a single test file

## Architecture

Single-page React+TypeScript app using Vite and Tailwind CSS. Source code is split into two top-level directories:

- **`src/core/`** — Platform-agnostic parsing and filtering. Accepts a `BagSource` (`{ name, data: Uint8Array }`) rather than a DOM `File`, so the same code runs in the browser today and can be reused from Node-based TUIs/CLIs later. Must not import from `src/web/`.
- **`src/web/`** — Browser-only React UI, styling, and DOM-side adapters (File upload, downloads).

Core modules:

- **`src/core/rosbagUtils.ts`** — ROS1 bag parsing (`loadRosbagMessages`), file format dispatch (`loadMessages`), message filtering (`filterMessages`, `filterDiagnostics`), and export functions (CSV/JSON/TXT/Parquet). Main module to test.
- **`src/core/mcapUtils.ts`** — MCAP file parsing (`loadMcapMessages`). Uses `@mcap/core` for reading, `@foxglove/rosmsg2-serialization` for CDR deserialization, and `fzstd` for zstd decompression.
- **`src/core/reindexUtils.ts`** — ROS1 bag reindexing and partial recovery for unindexed or damaged bag files. Rebuilds `IndexData`, `Connection`, and `ChunkInfo` records in-memory.
- **`src/core/types.ts`** — Core types (`BagSource`, `RosoutMessage`, `DiagnosticStatusEntry`, `SeverityLevel`) and level→name mappings.

Web modules:

- **`src/web/App.tsx`** — Monolithic UI component handling file upload (drag & drop), filtering, statistics, tab navigation (rosout vs diagnostics), and export triggering.
- **`src/web/fileAdapter.ts`** — Bridges the DOM `File` API to `BagSource` (`fileToBagSource`) and provides download helpers (`downloadFile`, `downloadBytes`).
- **`src/web/severityStyles.ts`** — Tailwind class strings for severity/diagnostic levels (kept out of core so non-UI reuse doesn't pull in UI styles).
- **`src/web/i18n.ts`** — English/Japanese dictionaries and `useI18n` hook.

## Constraints

- Keep the app offline-first. Do not introduce runtime dependencies on external servers or network connectivity.

## Key Domain Concepts

- **rosout messages** — ROS log messages with severity levels: DEBUG, INFO, WARN, ERROR, FATAL (internally string-based `SeverityLevel` type; ROS1 numeric 1/2/4/8/16 and ROS2 numeric 10/20/30/40/50 are both mapped on parse)
- **diagnostics** — Hardware/software diagnostic status from `/diagnostics_agg` topic with levels: OK(0), WARN(1), ERROR(2), STALE(3)
- Filtering supports OR/AND mode, node selection, severity filtering, keyword search, and regex patterns

## ADRs

Use an Architecture Decision Record when a change needs to preserve the reason behind a design choice, not just the implementation details.
When reviewing changes, explicitly check whether the PR introduces or materially changes a design or policy decision that should be captured as an ADR, and flag it if the rationale is not documented.

- Store ADRs in `docs/adr/`
- Use file names like `NNNN-short-kebab-case.md`
- Prefer `Proposed` while implementation is in progress, then update to `Accepted` once shipped
- Keep the ADR focused on one decision

### ADR Template

```md
# ADR: <short decision title>

- Status: Proposed
- Date: YYYY-MM-DD

## Context

Describe the technical background, current constraints, and the specific problem that requires a decision.

## Decision

State the decision clearly and directly.

## Decision Details

Document the concrete rules, scope, and implementation-facing behavior that follow from the decision.

## Alternatives Considered

List the main alternatives and why they were not chosen.

## Consequences

Describe the positive effects, negative effects, and ongoing maintenance cost.

## Verification / Guardrails

Capture the invariants, tests, and checks that should hold after the decision is implemented.
```
