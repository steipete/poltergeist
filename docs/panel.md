# Poltergeist Status Panel Plan

## Goal
Provide an interactive “panel” view that keeps project/target build status, recent log lines, and git dirty metrics visible while Poltergeist runs. The current `poltergeist status` output remains unchanged; the panel is discoverable via a hint plus `poltergeist status panel` (alias of `poltergeist panel`).

## Invocation & Discoverability
- New subcommand: `poltergeist status panel` (thin wrapper for `poltergeist panel`).
- When users run plain `poltergeist status`, append a one-line hint: `Tip: run "poltergeist status panel" for a live dashboard.`
- Exit codes match today’s status command to keep scripting expectations intact.

## Architecture Overview
1. **Data Source**  
   - Reuse existing status aggregation logic (state file scanner + parsing helpers).  
   - Watch `/tmp/poltergeist/` via the same mechanism the CLI currently uses (no new Watchman plumbing).  
   - State updates trigger UI refreshes; idle periods rely on the git polling timer.

2. **Git Metrics**  
   - Maintain a cache keyed by project root (available on every state record).  
   - On each state/log change and every 5 s interval:  
     - Run `git status --porcelain=v2 --branch` to count dirty files.  
     - Run `git diff --shortstat HEAD` (or equivalent) to capture added/removed line totals.  
   - Debounce per root so multiple targets in the same repo share results.

3. **Log Tail**  
   - For targets with `lastBuild.status` of `building` or `failure`, read the final ~20 lines from `FileSystemUtils.getLogFilePath(...)`.  
   - Cache handles to avoid reopening files rapidly; fall back gracefully if logs rotate.  
   - Display the active target’s log snippet in a dedicated panel.

4. **Ink UI Layout**  
   - Top: table listing project, target, status, build age, duration, dirty file count, LOC delta.  
   - Bottom: log viewer that auto-focuses on the highlighted row (keyboard arrows to change selection).  
   - Right gutter: compact cards summarizing totals (running builds, failures, queued targets).  
   - Use Ink’s `useInput` for shortcuts (`q` to quit, `r` to force git refresh).

## Implementation Steps
1. Build `git-metrics.ts` to collect dirty counts + LOC deltas with throttling and git error handling.  
2. Implement `StatusPanelController` under `src/panel/` to watch state files, poll git every 5 s, expose `onUpdate`, and provide log-tail helpers.  
3. Render the UI with Ink components (`PanelApp`) showing summary rows, git info, and a log pane that streams during builds.  
4. Wire CLI routing so `poltergeist status panel` and `poltergeist panel` both launch the Ink app, and emit a hint after the standard `status` output.  
5. Document usage in `docs/cli-reference.md`.

## Open Questions
- Should the panel collapse targets by project by default or list every target row? (Current behavior: list all rows.)  
- Is 5 seconds the right refresh cadence for git stats, or should we make it configurable? (Currently fixed at 5 s.)
