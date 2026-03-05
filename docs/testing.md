# Filter Test Specification

## Overview

This document defines the test specification for the filter functions in `src/rosbagUtils.ts`. It serves as the source of truth for test behavior — test code should be written (or rewritten) to match this spec.

### Target Functions

| Function | File | Description |
|---|---|---|
| `filterMessages` | `src/rosbagUtils.ts` | Filters rosout (`/rosout`, `/rosout_agg`) messages |
| `filterDiagnostics` | `src/rosbagUtils.ts` | Filters diagnostics (`/diagnostics_agg`) entries |

### Test Framework

- **vitest** (configured via Vite)
- Run: `npm test` (single run) / `npm run test:watch` (watch mode)
- Test file: `src/rosbagUtils.test.ts`

---

## Test Fixtures

### Rosout Messages

5 messages covering all severity levels and multiple nodes:

| # | timestamp | node | severity | message |
|---|-----------|------|----------|---------|
| 1 | 100 | `/node_a` | 1 (DEBUG) | `debug info here` |
| 2 | 200 | `/node_a` | 2 (INFO) | `all systems go` |
| 3 | 300 | `/node_b` | 4 (WARN) | `Warning: low battery` |
| 4 | 400 | `/node_b` | 8 (ERROR) | `Error: connection lost` |
| 5 | 500 | `/node_c` | 16 (FATAL) | `FATAL crash detected` |

### Diagnostic Entries

4 entries covering all diagnostic levels:

| # | timestamp | name | level | message |
|---|-----------|------|-------|---------|
| 1 | 100 | `/sensor/lidar` | 0 (OK) | `OK running` |
| 2 | 200 | `/sensor/camera` | 1 (WARN) | `Warning: low fps` |
| 3 | 300 | `/motor/left` | 2 (ERROR) | `Error: overheating` |
| 4 | 400 | `/motor/right` | 3 (STALE) | `Stale: no update` |

---

## filterMessages Spec

### Basics

| ID | Case | Filters | Expected |
|----|------|---------|----------|
| FM-01 | No filters | `{}` | All 5 messages returned |
| FM-02 | Empty input | messages=`[]`, filters=`{}` | Empty array |

### Severity Filter

| ID | Case | severityLevels | Expected |
|----|------|----------------|----------|
| FM-10 | Single severity | `{2}` | 1 message (INFO, `/node_a`) |
| FM-11 | Multiple severities | `{4, 8}` | 2 messages (WARN + ERROR) |
| FM-12 | Empty set | `{}` (empty Set) | All 5 (no filter applied) |

### Node Filter

| ID | Case | nodeNames | Expected |
|----|------|-----------|----------|
| FM-20 | Single node | `{/node_b}` | 2 messages |
| FM-21 | Multiple nodes | `{/node_a, /node_c}` | 3 messages |
| FM-22 | Non-matching node | `{/node_z}` | 0 messages |

### Keyword Filter

Activated when `useRegex=false`. Keywords are matched case-insensitively against `message`. Multiple keywords act as OR (any match counts).

| ID | Case | messageKeywords | Expected |
|----|------|-----------------|----------|
| FM-30 | Single keyword | `["error"]` | 1 message (matches "Error: connection lost") |
| FM-31 | Multiple keywords | `["debug", "fatal"]` | 2 messages |
| FM-32 | Empty entries ignored | `["", "  ", "error"]` | 1 message |
| FM-33 | All-empty entries | `["", "  "]` | All 5 (no keyword filter applied) |

### Regex Filter

Activated when `useRegex=true`. Pattern is case-insensitive (`'i'` flag).

| ID | Case | messageRegex | Expected |
|----|------|--------------|----------|
| FM-40 | Valid regex | `error.*lost` | 1 message (severity=8) |
| FM-41 | Case insensitive | `FATAL` | 1 message |
| FM-42 | Invalid regex | `[invalid(` | All 5 (filter skipped, warning logged) |
| FM-43 | Whitespace-only | `"   "` | All 5 (no filter applied) |

### Time Range Filter

Time range filters are applied as hard boundaries **before** OR/AND logic. Messages outside the range are always excluded.

| ID | Case | startTime | endTime | Expected |
|----|------|-----------|---------|----------|
| FM-50 | startTime only | 300 | — | 3 messages (t=300,400,500) |
| FM-51 | endTime only | — | 200 | 2 messages (t=100,200) |
| FM-52 | Both | 200 | 400 | 3 messages (t=200,300,400) |
| FM-53 | No match | 600 | 700 | 0 messages |

### OR Mode

Default mode. A message passes if **any** condition is true.

| ID | Case | Filters | Expected |
|----|------|---------|----------|
| FM-60 | Severity OR Node | severity=`{1}`, node=`{/node_c}` | 2 messages (t=100 via severity, t=500 via node) |

### AND Mode

A message passes only if **all** conditions are true.

| ID | Case | Filters | Expected |
|----|------|---------|----------|
| FM-70 | Severity AND Node (compatible) | severity=`{4,8}`, node=`{/node_b}` | 2 messages |
| FM-71 | Severity AND Node (conflict) | severity=`{1}`, node=`{/node_c}` | 0 messages |

### Combined Filters

| ID | Case | Filters | Expected |
|----|------|---------|----------|
| FM-80 | AND: severity + keyword | severity=`{4,8}`, keywords=`["battery"]`, mode=AND | 1 message (severity=4) |
| FM-81 | Time range + OR filter | severity=`{16}`, startTime=100, endTime=300, mode=OR | 0 messages (severity=16 is at t=500, excluded by time range) |

---

## filterDiagnostics Spec

### Basics

| ID | Case | Filters | Expected |
|----|------|---------|----------|
| FD-01 | No filters | `{}` | All 4 entries returned |
| FD-02 | Empty input | entries=`[]`, filters=`{}` | Empty array |

### Level Filter

| ID | Case | levels | Expected |
|----|------|--------|----------|
| FD-10 | Single level | `{0}` | 1 entry (`/sensor/lidar`) |
| FD-11 | Multiple levels | `{1, 2}` | 2 entries |
| FD-12 | Empty set | `{}` (empty Set) | All 4 (no filter applied) |

### Name Filter

| ID | Case | names | Expected |
|----|------|-------|----------|
| FD-20 | Single name | `{/motor/left}` | 1 entry |
| FD-21 | Non-matching name | `{/unknown}` | 0 entries |

### Keyword Filter

Activated when `useRegex=false`. Input is a comma-separated string. Case-insensitive.

| ID | Case | messageKeywords | Expected |
|----|------|-----------------|----------|
| FD-30 | Single keyword | `"overheating"` | 1 entry |
| FD-31 | Comma-separated | `"running,stale"` | 2 entries |
| FD-32 | All-empty entries | `",  ,"` | All 4 (no filter applied) |

### Regex Filter

| ID | Case | messageRegex | Expected |
|----|------|--------------|----------|
| FD-40 | Valid regex | `warning.*fps` | 1 entry |
| FD-41 | Invalid regex | `[bad(` | All 4 (filter skipped) |

### OR Mode

| ID | Case | Filters | Expected |
|----|------|---------|----------|
| FD-50 | Level OR Name | levels=`{0}`, names=`{/motor/right}` | 2 entries |

### AND Mode

| ID | Case | Filters | Expected |
|----|------|---------|----------|
| FD-60 | Level AND Name (compatible) | levels=`{2}`, names=`{/motor/left}` | 1 entry |
| FD-61 | Level AND Name (conflict) | levels=`{0}`, names=`{/motor/left}` | 0 entries |

---

## Adding New Tests

When adding new test cases:

1. **Add the spec here first** — assign an ID following the pattern (`FM-xx` / `FD-xx`), describe the condition and expected result
2. **Then write the test code** — implement the case in `src/rosbagUtils.test.ts` matching the spec
3. **Keep fixtures minimal** — add to the shared fixtures only if existing data cannot cover the new case
4. **One assertion focus per test** — each test should verify one specific filtering behavior

### Suggested areas for future test coverage

- Export functions (`exportToCSV`, `exportToJSON`, `exportToTXT`) — CSV escaping, timestamp formatting
- Statistics calculation (`calculateStatistics`)
- ROSbag loading (`loadRosbagMessages`) — error handling, topic detection
- Edge cases: very large message sets, Unicode in messages/node names, special characters in keywords
