import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import type { CMakeTarget } from '../src/utils/cmake-analyzer.js';
import { CMakeAnalyzer } from '../src/utils/cmake-analyzer.js';

describe('CMakeAnalyzer integration (stubbed deps)', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'cmake-analyzer-integration-'));
  writeFileSync(join(projectRoot, 'CMakeLists.txt'), '# dummy');
  writeFileSync(join(projectRoot, 'main.cpp'), '// cpp');
  writeFileSync(join(projectRoot, 'lib.c'), '// c');

  const parsedTargets: CMakeTarget[] = [
    {
      name: 'parsed-app',
      type: 'executable',
      sourceFiles: ['main.cpp'],
      dependencies: [],
      includeDirectories: [],
    },
  ];

  const buildTargets: CMakeTarget[] = [
    {
      name: 'parsed-app',
      type: 'executable',
      sourceFiles: ['generated.cpp'],
      dependencies: [],
      includeDirectories: [],
      outputPath: 'bin/app',
    },
    {
      name: 'built-lib',
      type: 'static_library',
      sourceFiles: [],
      dependencies: [],
      includeDirectories: [],
    },
  ];

  const parseStub = async () => parsedTargets;
  const queryStub = async () => ({
    targets: buildTargets,
    generator: 'Ninja',
    buildDirectory: 'build',
    errors: [],
  });

  it('merges parsed and build targets preferring build info', async () => {
    const analyzer = new CMakeAnalyzer(projectRoot, undefined, {
      parseCMakeFiles: parseStub,
      queryBuildSystem: queryStub,
    });

    const analysis = await analyzer.analyzeProject({ autoConfigure: false });

    expect(analysis.generator).toBe('Ninja');
    expect(analysis.buildDirectory).toBe('build');

    const names = analysis.targets.map((t) => t.name).sort();
    expect(names).toEqual(['built-lib', 'parsed-app']);

    const mergedApp = analysis.targets.find((t) => t.name === 'parsed-app');
    expect(mergedApp?.sourceFiles).toEqual(['generated.cpp']);
    expect(mergedApp?.outputPath).toBe('bin/app');
  });

  it('returns stubbed errors from build query', async () => {
    const analyzer = new CMakeAnalyzer(projectRoot, undefined, {
      parseCMakeFiles: parseStub,
      queryBuildSystem: async () => ({
        targets: [],
        generator: undefined,
        buildDirectory: 'build',
        errors: [
          {
            stage: 'query-targets',
            message: 'oops',
            details: 'details',
          },
        ],
      }),
    });

    const analysis = await analyzer.analyzeProject({ autoConfigure: false });
    expect(analysis.errors).toEqual([
      { stage: 'query-targets', message: 'oops', details: 'details' },
    ]);
  });

  afterAll(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });
});
