# AGENTS.md

This file provides guidance to coding agents working with code in this repository.

## Project Overview

Browser-based ROS1/ROS2 bag analyzer. Parses `.bag` files (ROS1) and `.mcap`/`.mcap.zstd` files (ROS2) entirely client-side. No backend required. Deployed to Cloudflare Pages.

## Commands

- `npm run dev` — Start dev server
- `npm run build` — Type-check with `tsc` then build with Vite
- `npm run lint` — ESLint (zero warnings allowed)
- `npm run test` — Run tests with Vitest
- `npm run test:e2e` — Run Playwright end-to-end tests
- `npm run test -- src/rosbagUtils.test.ts` — Run a single test file

## Architecture

Single-page React+TypeScript app using Vite and Tailwind CSS.

- **`src/App.tsx`** — Monolithic UI component handling file upload (drag & drop), filtering, statistics, tab navigation (rosout vs diagnostics), and CSV/JSON/TXT/Parquet export.
- **`src/rosbagUtils.ts`** — Core logic: bag file parsing (`loadRosbagMessages`), file format dispatch (`loadMessages`), message filtering (`filterMessages`, `filterDiagnostics`), and export functions. This is the main module to test.
- **`src/mcapUtils.ts`** — MCAP file parsing (`loadMcapMessages`). Uses `@mcap/core` for reading, `@foxglove/rosmsg2-serialization` for CDR deserialization, and `fzstd` for zstd decompression.
- **`src/reindexUtils.ts`** — ROS1 bag reindexing and partial recovery for unindexed or damaged bag files. Rebuilds `IndexData`, `Connection`, and `ChunkInfo` records in-browser.
- **`src/types.ts`** — Shared types (`RosoutMessage`, `DiagnosticStatusEntry`, `FilterConfig`) with `SeverityLevel` string union type (`'DEBUG'|'INFO'|'WARN'|'ERROR'|'FATAL'`) and Tailwind color mappings.

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
