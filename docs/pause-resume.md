---
summary: Proposal for pausing/resuming automatic builds in Poltergeist
---

# Pause/Resume Controls

Goal: let users temporarily stop **automatic** builds/watch-triggered jobs while keeping manual `poltergeist` commands fully functional. Pausing does **not** kill in‑flight processes; it simply prevents new auto-builds from starting. This should work both from the TUI panel and the CLI.

## UX

- **Panel hotkeys**
  - `p` — pause auto-builds
  - `r` — resume auto-builds
  - Show a header badge: “⏸ auto-builds paused (r to resume)” and per-target status badge “paused” while suspended.
- **CLI**
  - `poltergeist pause` — set pause flag (does not stop running builds)
  - `poltergeist resume` — clear pause flag
  - If a command like `poltergeist build <target>` is invoked while paused, still run it but print a one-liner: “Auto-builds are paused; this manual build will run anyway.”

## Persistence

- Store a per-project pause flag in the existing state directory: `getStateDirectory()/PROJECTHASH.paused`.
- Daemon reads the flag on start and watches it (poll or file-change) to update in-memory `isPaused`.
- Panel snapshot includes `paused: boolean` so UI can show the banner immediately after toggles or restarts.

## Behavior

- When `isPaused` is true:
  - Queue/watcher callbacks short-circuit before enqueueing builds.
  - `buildTarget` returns early without clearing pending files so they run after resume.
  - Existing builds are left alone; finishes/reporting still update state.
- On resume:
  - Clear pause flag, allow new enqueues, and optionally trigger a single catch-up build per target if pending files exist.

## Implementation notes

- Add `paused` to `BuildStatusType` and panel badges (`⏸ paused`, muted color).
-,Add helper in `FileSystemUtils`: `getPauseFilePath(projectRoot)` + `readPauseFlag` / `writePauseFlag`.
- Daemon: keep an `isPaused` flag; refresh it when pause file changes, and expose to panel via snapshot.
- Panel controller: expose `pause()` / `resume()` RPCs the hotkeys call; update snapshot/refresh immediately.
- CLI: add `pause`/`resume` commands in `daemon.ts` that set/clear the flag (no daemon restart required). Manual builds emit the friendly “auto-builds paused” line when paused.

## Out of scope (for now)

- Killing or suspending in-flight processes.
- Per-target pause; this is global per project.

## Quick test plan

1. Start daemon, press `p` in the panel → header shows paused, file changes don't trigger builds.
2. Run `pnpm exec poltergeist pause` while the panel is closed → reopening shows paused.
3. Run `poltergeist build Integration Tests` while paused → build runs; console shows the one-liner; auto triggers remain blocked.
4. Press `r` → queued changes build once; paused badge disappears.
