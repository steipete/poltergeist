#!/usr/bin/env bun

// Bun compiled binaries use argv[1] for the first user argument, so provide the
// script path expected by the shared Node/Bun entrypoint guard.
process.argv.splice(1, 0, "/polter");
await import("../src/polter.js");
