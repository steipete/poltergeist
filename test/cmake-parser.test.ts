import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { parseCMakeFiles } from '../src/utils/cmake-parser.js';

describe('cmake parser', () => {
  it('parses executables and libraries with sources', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmake-parser-'));
    writeFileSync(
      join(dir, 'CMakeLists.txt'),
      `
        add_executable(app main.cpp util/helpers.c)
        add_library(core STATIC src/core.cpp src/core.h)
      `
    );
    mkdirSync(join(dir, 'util'), { recursive: true });
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'main.cpp'), '// main');
    writeFileSync(join(dir, 'util/helpers.c'), '// c');
    writeFileSync(join(dir, 'src/core.cpp'), '// core');
    writeFileSync(join(dir, 'src/core.h'), '// h');

    const targets = await parseCMakeFiles(dir);

    const names = targets.map((t) => t.name).sort();
    expect(names).toEqual(['app', 'core']);

    const app = targets.find((t) => t.name === 'app');
    expect(app?.type).toBe('executable');
    expect(app?.sourceFiles).toEqual(['main.cpp', 'util/helpers.c']);

    const core = targets.find((t) => t.name === 'core');
    expect(core?.type).toBe('static_library');
    expect(core?.sourceFiles).toEqual(['src/core.cpp', 'src/core.h']);

    rmSync(dir, { recursive: true, force: true });
  });

  it('ignores non-source entries and variables', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmake-parser-'));
    writeFileSync(
      join(dir, 'CMakeLists.txt'),
      `add_executable(app ${'{PROJECT_SOURCES}'} "../outside.c" script.py)`
    );

    const targets = await parseCMakeFiles(dir);
    const app = targets[0];
    expect(app.sourceFiles).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});
