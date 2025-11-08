import { describe, expect, it } from 'vitest';
import picomatch, { createMatcher } from '../../src/utils/glob-matcher.js';

describe('glob matcher', () => {
  it('matches nested paths with ** patterns', () => {
    const matcher = createMatcher('src/**/*.ts');

    expect(matcher('src/app/main.ts')).toBe(true);
    expect(matcher('src/main.ts')).toBe(true);
    expect(matcher('src/app/styles.css')).toBe(false);
  });

  it('supports character classes and single-character wildcards', () => {
    const matcher = createMatcher('test/[ab]?/file.js');

    expect(matcher('test/a1/file.js')).toBe(true);
    expect(matcher('test/bz/file.js')).toBe(true);
    expect(matcher('test/cz/file.js')).toBe(false);
  });

  it('handles brace expansions for extensions', () => {
    const matcher = createMatcher('dist/**/*.{js,ts}');

    expect(matcher('dist/app.mjs')).toBe(false);
    expect(matcher('dist/index.js')).toBe(true);
    expect(matcher('dist/nested/util.ts')).toBe(true);
  });

  it('escapes and matches literal characters correctly', () => {
    const matcher = createMatcher('logs/app(1).log');

    expect(matcher('logs/app(1).log')).toBe(true);
    expect(matcher('logs/app2.log')).toBe(false);
  });

  it('exposes picomatch-compatible default export', () => {
    const matcher = picomatch('examples/*.md');

    expect(matcher('examples/README.md')).toBe(true);
    expect(matcher('examples/docs/guide.md')).toBe(false);
  });
});
