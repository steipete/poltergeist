// Utilities for optimizing CMake-related watch patterns

/**
 * Optimize watch patterns by consolidating paths using brace expansion.
 * This function is pure and safe to unit-test independently of the analyzer.
 */
export function optimizeWatchPatterns(patterns: string[]): string[] {
  const uniquePatterns = [...new Set(patterns)];

  const nonRedundant = uniquePatterns.filter((pattern, index) => {
    for (let i = 0; i < uniquePatterns.length; i++) {
      if (i !== index && isPatternRedundant(pattern, uniquePatterns[i])) {
        return false;
      }
    }
    return true;
  });

  const patternsWithBraces: string[] = [];
  const nonWildcardPatterns: string[] = [];
  const wildcardPatterns: string[] = [];

  nonRedundant.forEach((pattern) => {
    const hasDirectoryBraces = pattern
      .split('/')
      .some((part) => part.includes('{') && !part.startsWith('*.{'));

    if (hasDirectoryBraces) {
      patternsWithBraces.push(pattern);
    } else if (!pattern.includes('*')) {
      nonWildcardPatterns.push(pattern);
    } else {
      wildcardPatterns.push(pattern);
    }
  });

  const groups = new Map<string, Set<string>>();
  const processed = new Set<string>();

  for (let i = 0; i < wildcardPatterns.length; i++) {
    if (processed.has(wildcardPatterns[i])) continue;

    const pattern1 = wildcardPatterns[i];
    const parts1 = pattern1.split('/');
    const matches: string[] = [pattern1];

    for (let j = i + 1; j < wildcardPatterns.length; j++) {
      if (processed.has(wildcardPatterns[j])) continue;

      const pattern2 = wildcardPatterns[j];
      const parts2 = pattern2.split('/');

      if (parts1.length !== parts2.length) continue;

      let diffIndex = -1;
      let allOthersSame = true;

      for (let k = 0; k < parts1.length; k++) {
        if (parts1[k] !== parts2[k]) {
          if (diffIndex === -1) {
            diffIndex = k;
          } else {
            allOthersSame = false;
            break;
          }
        }
      }

      if (
        allOthersSame &&
        diffIndex !== -1 &&
        !parts1[diffIndex].includes('*') &&
        !parts2[diffIndex].includes('*')
      ) {
        matches.push(pattern2);
      }
    }

    if (matches.length > 1) {
      const parts = pattern1.split('/');
      let diffIndex = -1;

      for (let k = 0; k < parts.length; k++) {
        const values = new Set(matches.map((m) => m.split('/')[k]));
        if (values.size > 1) {
          diffIndex = k;
          break;
        }
      }

      if (diffIndex !== -1) {
        const prefix = parts.slice(0, diffIndex).join('/');
        const suffix = parts.slice(diffIndex + 1).join('/');
        const key = `${prefix}|${suffix}`;

        groups.set(key, new Set(matches.map((m) => m.split('/')[diffIndex])));
        matches.forEach((m) => {
          processed.add(m);
        });
      }
    }
  }

  const result: string[] = [];

  groups.forEach((dirsSet, key) => {
    const [prefix, suffix] = key.split('|');
    const dirs = Array.from(dirsSet).sort();

    let pattern: string;
    if (prefix && suffix) {
      pattern = `${prefix}/{${dirs.join(',')}}/${suffix}`;
    } else if (prefix) {
      pattern = `${prefix}/{${dirs.join(',')}}`;
    } else if (suffix) {
      pattern = `{${dirs.join(',')}}/${suffix}`;
    } else {
      pattern = `{${dirs.join(',')}}`;
    }
    result.push(pattern);
  });

  wildcardPatterns.forEach((pattern) => {
    if (!processed.has(pattern)) {
      result.push(pattern);
    }
  });

  result.push(...patternsWithBraces);
  result.push(...nonWildcardPatterns);

  return result.sort();
}

/**
 * Check if pattern1 is redundant given pattern2 exists.
 */
export function isPatternRedundant(pattern1: string, pattern2: string): boolean {
  if (pattern1 === pattern2) {
    return false;
  }

  const getPatternParts = (pattern: string) => {
    const wildcards = ['/**/*.', '/**/*', '/**/'];
    for (const wc of wildcards) {
      const idx = pattern.indexOf(wc);
      if (idx !== -1) {
        return {
          base: pattern.substring(0, idx),
          wildcard: wc,
          extension: pattern.substring(idx + wc.length),
        };
      }
    }
    return null;
  };

  const parts1 = getPatternParts(pattern1);
  const parts2 = getPatternParts(pattern2);

  if (!parts1 || !parts2) {
    return false;
  }

  if (!parts2.base && parts1.base) {
    if (parts1.extension === parts2.extension) {
      return true;
    }
  }

  if (parts1.base && parts2.base && parts1.base.startsWith(`${parts2.base}/`)) {
    if (parts1.extension === parts2.extension) {
      return true;
    }
  }

  return false;
}
