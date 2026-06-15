#!/usr/bin/env bun

import { normalizePolterArgv } from "../src/utils/paths.js";

// Older Bun binaries use argv[1] for the first user argument. Current binaries
// provide a virtual bunfs script path, which must not be duplicated.
process.argv = normalizePolterArgv(process.argv);
await import("../src/polter.js");
