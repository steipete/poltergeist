# End-to-End Example Test Notes

These scenarios are exercised with `pnpm exec tsx scripts/run-examples.ts`.  
The runner wipes any prior state, runs `poltergeist init`, asserts minimal config output, starts a foreground daemon, touches source files, and validates the resulting artefacts. Build logs and final statuses are written to `docs/test-e2e-report.json` after each run.

## Node TypeScript (`examples/node-typescript`)
- Auto detection produces a single enabled target with minimal settings.
- Touching `src/index.ts` injects a unique token; Watchman events queue a rebuild, and the runner waits for Poltergeist to finish it.
- Executing `node dist/index.js` prints the token, verifying the compiled output reflects the change (no manual fallback required).

## C Hello (`examples/c-hello`)
- Makefile detection enables the `hello` target automatically.
- Updating `main.c` re-runs `make hello`, recreating the binary.
- Running `./hello` prints `Hello from C!`.

## Python Simple (`examples/python-simple`)
- Auto detection emits an enabled `test` target invoking the unittest suite.
- Touching `src/main.py` regenerates `test-results.txt`.
- The captured report ends with `OK`, confirming successful test execution.

## CMake Library (`examples/cmake-library`)
- `poltergeist init --cmake` analyses available targets, validates that `cmake` is present, and configures two build targets.
- Touching `src/math_ops.c` triggers the generated CMake build pipeline.
- Running `./build/test_mathlib` prints `Testing MathLib`, confirming the rebuild.
