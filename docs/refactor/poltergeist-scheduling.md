# Poltergeist Scheduling & Watch Service Follow-Ups

Purpose: capture improvements after reviewing the current build queue + debounce flow and Watchman subscription handling.

## Problems Observed
- Intelligent build queue bypassed settling delays, causing immediate builds and flakey tests that expect debounce behaviour.
- File change handling duplicated queue vs. debounce paths, making coalescing logic diverge.
- `WatchService` carried a stray duplicate method stub, leading to invalid TypeScript in some toolchains.

## Changes Implemented Now
- Unified file-change handling through the debounced scheduler; after the settling delay it routes to either the priority queue or direct builds.
- Debounced scheduler now passes the aggregated file list to its callback, letting the queue and coordinator share the same coalesced inputs.
- Cleaned `WatchService` by keeping a single `attachHandlersTo` no-op hook (test compatibility) and removing the duplicate definition.

## Next Opportunities
- Add queue-aware tests that assert debounced behaviour plus priority ordering to prevent regressions.
- Consider trimming emoji in log lines for CI readability and to simplify assertions.
- Expose a small diagnostics hook on the scheduler (e.g., last-triggered timestamps) to aid testability without poking timers directly.
