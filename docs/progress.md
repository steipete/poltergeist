---
summary: 'Build/test progress reporting in Poltergeist'
read_when:
  - 'adding progress indicators to builds'
  - 'debugging progress bars in the status panel'
---

# Progress Reporting

Poltergeist surfaces live progress for builds and tests and renders a text bar in the `poltergeist status panel` when available.

## What is tracked

- **SwiftPM builds**: lines like `[12/50] Compiling Foo.swift` are parsed from stdout.
- **XCTest runs**: lines `Test Case '-[Suite testX]' passed/failed ...` increment the counter; the final `Executed N tests` summary supplies a total when present.

Each update writes a `progress` payload into the target’s state file:

- `current`, `total`, `percent`
- optional `label` (e.g., `Compiling Foo.swift` or `Test 3/20`)
- `updatedAt` ISO timestamp

## Where it shows up

- `poltergeist status panel`: building targets show `⧗` plus the progress bar (e.g., `24% [████░░░░] 12/50 Compiling Foo.swift`).
- `poltergeist status --json`: `lastBuild.progress` mirrors the same payload for consumers.

## Caveats

- Parsing is heuristic; non-Swift builders/tests need to emit `[n/total]` or adopt a future structured marker to be picked up.
- Progress writes are throttled (~300 ms) to avoid excessive state churn.

## Adding progress for other targets

Emit a line matching `^[n/total] Description` on stdout (or extend the builder with a target-specific regex) to feed the same channel. Keep totals stable to avoid jumpy percentages.
