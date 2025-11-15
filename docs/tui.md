# pi-tui Migration Plan

## Objectives
- Replace the Ink + Ink Markdown panel implementation with `@mariozechner/pi-tui` while maintaining the existing feature set (targets table, git + dirty summaries, AI markdown output, log tailing, controls).
- Ensure all textual blocks use pi-tui’s `Text` component so the renderer manages wrapping and padding.
- Consume the published npm release of `@mariozechner/pi-tui` (no local file dependency) and remove the Ink/React stack entirely.

## Constraints & Notes
- Only the AI summary requires Markdown rendering; everything else stays plain text.
- Input handling must preserve the current UX: `↑/↓` to select targets, `r` to refresh, `q`/`Ctrl+C` to exit.
- Alternate-buffer + cursor visibility toggling must still occur when launching the panel.
- Log tailing should refresh every second while a target is building; otherwise it stays static.

## Workstreams
1. **Component Audit (Completed)**  
   Catalog required Ink components/features and how they’re used: project header, target rows, per-target status scripts, dirty files fallback, AI summary, logs panel, footer, resize handling, keybindings, controller polling.

2. **pi-tui Capability Study (Completed)**  
   Review `@mariozechner/pi-tui` sources (`Text`, `Markdown`, `Container`, `TUI`, `ProcessTerminal`) to map equivalents for every Ink construct and verify they meet wrapping + markdown needs.

3. **Dependency Migration**  
   Remove `ink`, `react`, related typings, and add `@mariozechner/pi-tui` to `dependencies`. Update build artifacts (`tsconfig`, lint ignores, etc.) to point at the new entry.

4. **Panel UI Rewrite**  
   - Rebuild `panel-app` as a pi-tui component tree (containers + text blocks for each section).  
   - Replace inline Markdown parser with `Markdown` component for the AI summary.  
   - Keep palette + formatting helpers (duration/relative time) and adjust to produce plain strings fed into `Text`.  
   - Wire controller snapshot updates to mutate pi-tui components and request renders.  
   - Ensure log tailing and status script rendering still stream into the layout.

5. **Bootstrap & Lifecycle**  
   - Update `run-panel` to instantiate `ProcessTerminal` + `TUI`, manage alternate-buffer enter/leave, and hook controller lifecycle (`start`, `dispose`).  
   - Forward stdin events to a focused input handler that drives target selection, refresh, exit.  
   - Add smoke tests/manual instructions to validate `poltergeist panel` works inside a TTY.

## Open Questions
- None currently; layout tweaks are acceptable if they simplify the rewrite, per user guidance.
