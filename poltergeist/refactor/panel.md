# Panel Refactor Task List

- Extract rendering/formatting logic out of `src/panel/panel-app.ts` into a dedicated helper module (e.g., `render-utils.ts`). Keep `panel-app` focused on orchestration and state wiring.
- Split text/width helpers (pad, centerText, visible width-dependent pieces) into a tiny utility to avoid duplication.
- Move log filtering/formatting (build/test channels, (no logs) centering) into reusable helpers with unit tests.
- Keep tree flattening in `target-tree.ts` but wire `panel-app` to consume it directly for selection/rendering; ensure navigation uses flattened rows.
- Ensure controls line always renders as the last line of the panel output; keep it centered/sized appropriately for narrow terminals.
- Maintain channel cycling behavior per row (left/right) and summary toggling; make sure indentation/connectors render for grouped targets.
- Add/adjust tests: target-tree (already present), log formatting, and render helpers to lock centered placeholders and connectors.
- Run Biome check and targeted Vitest runs for the new helpers.

### Next improvements to tackle
- ✅ Extract remaining orchestration/state helpers (`summary` mode resolution, log channel index sync, selection defaults) into a slim `panel-state` module to trim `panel-app.ts`.
- ✅ Make rendering fully pure: derive `PanelViewState` from a snapshot+terminal size in a pure function so it’s unit-testable without `ProcessTerminal`.
- ✅ Improve log polling: keep 1s while building and add a post-build backoff refresh instead of constant polling.
- ✅ Persist summary choice: remember last manually selected summary mode independent of target navigation so selection doesn’t reset.
- ✅ Add width-aware elision for long target names/status badges on very narrow terminals; covered by formatTargets test.
- ✅ Visually separate global scripts (label/divider) to distinguish them from target rows in dense outputs.
- ✅ Better empty states: when no targets exist, show a short hint on how to populate panel/status data.
- ✅ Provide a monochrome/no-color mode by shimming the `colors` palette (POLTERGEIST_MONOCHROME=1).
- ✅ Event-triggered log refresh: panel now listens to `log-update` events and refreshes logs immediately when status/summary data change.
- ✅ Cache `buildTargetRows` within a render pass using snapshot versioning.
- ✅ Added extra tests: truncation, header compact/narrow separators, log wrapping.
- Remaining: fine-tune badge-width elision & document new flags (monochrome), consider additional `formatLogs` multiline cases if needed.
