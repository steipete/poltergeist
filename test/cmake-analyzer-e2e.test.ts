import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { CMakeAnalyzer } from '../src/utils/cmake-analyzer.js';
import type { CommandRunner, RunResult } from '../src/utils/command-runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class StubRunner implements CommandRunner {
  constructor(private readonly stdout: string) {}

  async run(): Promise<RunResult> {
    return { stdout: this.stdout, stderr: '', exitCode: 0 };
  }
}

describe('CMakeAnalyzer end-to-end with fixture project', () => {
  const projectRoot = join(__dirname, '../test-cmake');

  const helpOutput = `\nThe following are some of the valid targets\n... test-cmake\n... libtest-cmake\n`;

  it('produces merged targets and watch patterns for fixture', async () => {
    const analyzer = new CMakeAnalyzer(projectRoot, new StubRunner(helpOutput));
    const analysis = await analyzer.analyzeProject({ autoConfigure: false });

    expect(analysis.generator).toBe('Ninja');
    expect(analysis.buildDirectory).toBe('build');
    const names = analysis.targets.map((t) => t.name).sort();
    expect(names).toEqual(expect.arrayContaining(['libtest-cmake', 'test-cmake']));

    const polterTargets = analyzer.generatePoltergeistTargets(analysis);
    const polterNames = polterTargets.map((t) => t.name).sort();
    expect(polterNames).toEqual(expect.arrayContaining(['libtest-cmake', 'test-cmake']));

    const watchPatterns = analyzer.generateWatchPatterns(analysis);
    expect(watchPatterns).toContain('**/CMakeLists.txt');
    expect(watchPatterns.some((p) => p.includes('{cpp'))).toBe(true);
  });
});
