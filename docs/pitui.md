# pi-tui Panel Performance Notes

## Instrumentation
- Enable profiling with `POLTERGEIST_PANEL_PROFILE=1`.
- Logs emitted:
  - `refreshStatus` phase timings (status fetch, git refresh, emit).
  - Status script execution timing/cache hits.
  - View updates with reason, width, target/log counts.
  - Log refresh timings; skips when a refresh is already pending.

## Startup flow
- Panel now renders immediately after the first status snapshot (status + git); status scripts run asynchronously afterward so the UI becomes visible sooner.

## Incremental updates
- View updates are tagged with a reason (`snapshot`, `selection`, `logs`, `logs-reset`, `resize`, `init`) to correlate render cost with triggers.
- Width is passed through so rules/log wrappers scale with terminal size; render timing is logged when profiling is on.

## Log tailing
- Only one log read can be pending; additional requests are skipped (and profiled) to avoid starving the render loop while rapidly switching targets or during heavy log writes.

## Knobs & recommendations
- `POLTERGEIST_PANEL_PROFILE=1` for ad-hoc profiling in real terminals.
- Use per-status-script `cooldownSeconds` in `poltergeist.config.json` for expensive scripts on large projects.
- Keep `statusScripts.maxLines` narrow to limit diff size and render cost for long outputs.

## Follow-ups to consider
- Upstream a word-wrap option to `@mariozechner/pi-tui`’s Markdown (currently patched locally).
- Expose a render duration hook from pi-tui to measure actual paint time vs. string assembly.
