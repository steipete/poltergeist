# Status Panel Tracker

This document tracks the current behaviour and expectations for the Poltergeist “status panel” (`poltergeist status panel` / `poltergeist panel`). It complements the README section and should stay current whenever the Ink UI, git metrics, or status-script plumbing changes.

## Launching & Discoverability

- `poltergeist status panel` acts as a discoverable alias to `poltergeist panel`. Running plain `poltergeist status` still prints the one-line hint (`Tip: run "poltergeist status panel" for a live dashboard.`).
- The panel requires an interactive TTY. When available, it switches into the terminal’s alternate buffer, hides the cursor, and pins the control row (`Controls: ↑/↓ move · r refresh · q quit`) to the very bottom line.
- `pnpm run poltergeist:self:panel` is wired with `node --watch` so the dashboard restarts when the CLI recompiles (used while Poltergeist watches itself).

## Layout & Controls

| Region | Contents |
| --- | --- |
| Header table | One row per target showing status, last build timestamp, duration, and process state. Disabled targets are labelled inline. |
| Status scripts | Lines emitted by `statusScripts` render directly under their associated targets (or in a global block if no targets are listed). Each line includes a duration badge. |
| Git insights | Either a dirty-file list (grouped by directory, max 10 entries + “…and N more”) or the AI summary block described below. |
| Log tail | The selected target’s latest log lines (auto-sized so it fills remaining vertical space without overflowing). |
| Controls row | Always on the last terminal row. `q`/`Ctrl+C` exit; `r` forces a state + git refresh; ↑/↓ change selection. |

## Git Metrics & AI Summaries

- Git polling runs every 5 s (configurable via `gitPollIntervalMs` when embedding `StatusPanelController`).
- Each project caches dirty counts, file lists, insertions, and deletions. Results are shared across multiple targets from the same repo.
- The panel accepts `--git-mode ai|list` (default `ai`, also overridable via `POLTERGEIST_GIT_MODE`).  
  - **List mode** shows the grouped dirty-file block.  
  - **AI mode** launches a background Claude CLI call (`claude -p "... --model haiku"`) when there are dirty files, deduped by the tuple `(dirtyFiles, insertions, deletions)` so summaries stay stable until something actually changes. When AI mode is active we hide the raw file list and show a markdown-aware bullet list titled “AI summary of changed files”.
- Failures to contact Claude fall back silently to the list output and log a warning (so panel rendering never blocks).

## Status Scripts

`statusScripts` let projects surface lightweight health checks (linters, smoke tests, etc.) without hard-coding them into Poltergeist. Configuration recap:

```jsonc
{
  "label": "SwiftLint",
  "command": "./scripts/status-swiftlint.sh",
  "targets": ["peekaboo"],
  "cooldownSeconds": 60,
  "timeoutSeconds": 300,
  "maxLines": 6
}
```

- Scripts run from the project root, inherit the environment, and are throttled by `cooldownSeconds` (default 60 s).
- Output is truncated to `maxLines` (default 1). The first line gets `Label: text [duration]`; subsequent lines are indented.
- Exit code determines colour: 0/negative = success (green), >0 = failure (red).  
- Example from Peekaboo’s lint script:  
  `SwiftLint: 0 errors / 0 warnings [31s]`

## Self-hosting / Hot Reload

When working on Poltergeist itself:

1. `pnpm run build` once to seed `dist/`.
2. Terminal A: `pnpm run poltergeist:self:haunt` (spawns daemon).
3. Terminal B: `pnpm run poltergeist:self:panel` (auto-restarts via `node --watch --watch-path dist`).
4. Any code change rebuilds `dist/`; the panel restarts automatically and continues tailing `/tmp/poltergeist/` logs.

## Implementation Notes

- `StatusPanelController` watches `/tmp/poltergeist/` for state file changes, polls git + status scripts on their own timers, and exposes snapshots via an event emitter.
- `git-metrics.ts` single-flights expensive work, caches the latest snapshot, and only restarts the Claude job when the dirty signature changes. When a repo becomes clean it purges cached summaries/cooldowns.
- `panel-app.tsx` is responsible for terminal layout. The log container’s height is measured with `measureElement` so we never overrun the terminal and accidentally hide the header.

Keep this tracker updated whenever the Ink UI, git polling cadence, AI summary prompt, or CLI surface changes. README and docs/cli-reference.md should cross-link here for deeper details.
