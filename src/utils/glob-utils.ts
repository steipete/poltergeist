function splitBraceContent(content: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let escaped = false;
  for (const char of content) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === "\\") {
      current += char;
      escaped = true;
    } else if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      if (char === "{") depth++;
      if (char === "}") depth--;
      current += char;
    }
  }
  // Preserve empty arms here: a surrounding prefix or suffix may fill them.
  parts.push(current);
  return parts;
}

function expandPattern(pattern: string): string[] {
  let braceIndex = -1;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "\\") {
      i++;
    } else if (pattern[i] === "{") {
      braceIndex = i;
      break;
    }
  }
  if (braceIndex === -1) {
    return [pattern];
  }

  let depth = 0;
  let endIndex = -1;
  for (let i = braceIndex; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "\\") {
      i++;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        endIndex = i;
        break;
      }
    }
  }

  if (endIndex === -1) {
    return [pattern];
  }

  const before = pattern.slice(0, braceIndex);
  const inside = pattern.slice(braceIndex + 1, endIndex);
  const after = pattern.slice(endIndex + 1);

  const parts = splitBraceContent(inside);
  const afterExpansions = expandPattern(after);
  const results: string[] = [];

  for (const part of parts) {
    const partExpansions = expandPattern(part);
    for (const partExpansion of partExpansions) {
      if (afterExpansions.length > 0) {
        for (const suffix of afterExpansions) {
          results.push(`${before}${partExpansion}${suffix}`);
        }
      } else {
        results.push(`${before}${partExpansion}`);
      }
    }
  }

  return results;
}

export function expandGlobPattern(pattern: string): string[] {
  return Array.from(new Set(expandPattern(pattern).filter((expanded) => expanded.length > 0)));
}

export function expandGlobPatterns(patterns: string[]): string[] {
  const expanded = patterns.flatMap((pattern) => expandGlobPattern(pattern));
  return Array.from(new Set(expanded));
}
