# Copilot Code Review Instructions

## Repository Context

This repository is a browser-based ROS1/ROS2 bag file analyzer built with React, TypeScript, and Vite.
File parsing and data processing run fully client-side in the browser. Node.js is used mainly for build, test, and tooling.

Before reviewing a change, first confirm which area it affects:

- Frontend UI and interaction flow
- Client-side data processing and parsing
- Build, test, or tooling configuration

Key areas to understand before commenting:

- `src/web/App.tsx` - Main UI flow, upload handling, filters, exports, tabs, and diagnostics interactions
- `src/web/fileAdapter.ts` - Browser adapters: File → BagSource conversion and download helpers
- `src/core/rosbagUtils.ts` - ROS bag loading (from a BagSource), filtering, and export logic
- `src/core/mcapUtils.ts` - MCAP parsing and message extraction
- `src/core/reindexUtils.ts` - Reindexing for unindexed or damaged ROS1 bag files
- `src/core/types.ts` - Core types (BagSource, RosoutMessage, DiagnosticStatusEntry) and severity mappings
- `e2e/*.spec.ts` - Browser-level behavior and integration coverage

## Review Approach

Prioritize findings that indicate:

- User-facing frontend regressions
- Incorrect parsing, filtering, export, or diagnostics behavior
- Missing or mismatched tests for changed behavior
- Unsafe TypeScript or error-handling patterns
- Dependency or runtime-boundary mistakes

Do not start from general Node.js advice. First verify the runtime boundary, the existing implementation style, and the library APIs already used in this codebase.

Also check whether the change should be documented as an ADR.
Flag missing ADR coverage when a PR introduces or materially changes an architectural or policy-level decision whose rationale should be preserved, not just its implementation.
Typical examples include:

- Recovery or failure-handling policy changes, such as partial recovery rules or warning classification
- Offline/runtime-boundary decisions
- Data format compatibility or parsing strategy changes
- Cross-cutting behavior contracts that multiple modules must follow

Do not ask for an ADR for routine bug fixes, local refactors, isolated UI tweaks, or test-only changes unless they also introduce a lasting design decision.

## Frontend Review Priorities

Frontend changes should receive extra scrutiny. Focus on:

- Upload flow regressions, including loading state, success state, and error state
- Filter UI correctness for rosout and diagnostics views
- Export UI behavior and filename/type correctness
- Diagnostics tab behavior, row expansion, and state transitions
- Reindex notice and download flow for unindexed bag files
- Accessibility for buttons, file inputs, tabs, toggles, and icon-only controls
- Hook rules and `useEffect` dependency correctness
- State updates that can drift out of sync with visible UI

Flag React performance issues only when there is a concrete render-time cost or a clear unnecessary re-render problem. Do not recommend `useMemo` or `useCallback` by default.

## Data Processing and Node.js / TypeScript Guidance

Data-processing logic is a high-priority review area, but do not assume the implementation should follow generic server-side Node.js patterns.

When reviewing parsing or export logic:

- Confirm whether the code runs in the browser, not just whether it is written in TypeScript
- Check for type safety, null safety, and explicit error handling
- Verify dependency placement: browser runtime dependencies belong in `dependencies`; build and test tools belong in `devDependencies`
- Prefer `async/await` for Promise-based APIs
- Do not flag callback-style code when it is required by an existing library API, such as ROS bag reader callbacks

Logic correctness to verify:

- ROS1 severity mapping: `1=DEBUG`, `2=INFO`, `4=WARN`, `8=ERROR`, `16=FATAL`
- ROS2 severity mapping: `10=DEBUG`, `20=INFO`, `30=WARN`, `40=ERROR`, `50=FATAL`
- Diagnostics mapping: `0=OK`, `1=WARN`, `2=ERROR`, `3=STALE`
- Filter logic preserves documented OR/AND behavior
- CSV/JSON/TXT/Parquet exports faithfully reflect filtered data
- Parsing remains fully local and does not introduce network-based processing
- Large-file handling does not introduce obvious new main-thread blocking behavior

## Test Expectations by Change Type

Do not require a single test style for all changes. First classify the change.

- Pure filtering, transform, or deterministic export logic changes should usually add or update Vitest coverage in `src/core/rosbagUtils.test.ts`
- Browser interaction, upload/download flow, parsing integration, MCAP behavior, reindex behavior, and UI-driven export behavior may be validated with Playwright E2E tests under `e2e/*.spec.ts`
- If behavior changes and neither unit tests nor E2E coverage change, flag the missing coverage
- Do not reject a change only because the test was added in E2E instead of unit test when E2E is the correct layer

## Validation Commands

Use these as the baseline validation commands:

```bash
npm run lint
npm run test
npm run build
```

If a change touches upload flow, parsing, export behavior, diagnostics interactions, reindex behavior, or other browser-level workflows, also consider:

```bash
npm run test:e2e
```

Flag changes that are likely to break these commands or invalidate the covered behavior.

## What Not to Flag

Do not flag the following unless there is a concrete correctness or maintainability issue:

- Valid callback-based use of existing parsing library APIs
- Missing unit tests when the behavior is already appropriately covered by E2E
- Pure style issues already handled by ESLint or formatting tools
- Minor naming preferences that do not affect behavior
- Speculative frontend performance concerns without evidence
- Generic Node.js guidance that ignores the browser runtime of this app
