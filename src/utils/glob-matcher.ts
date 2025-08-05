//
//  glob-matcher.ts
//  Poltergeist
//

/**
 * Cross-runtime glob pattern matcher.
 * Uses Bun.Glob when available (3x faster), otherwise falls back to a minimal implementation.
 */

// Type declaration for Bun global
declare global {
  const Bun:
    | {
        Glob?: new (
          pattern: string
        ) => {
          match(path: string): boolean;
        };
      }
    | undefined;
}

// Check if we're running in Bun
const isBun = typeof Bun !== 'undefined';

/**
 * Creates a function that tests if a path matches a glob pattern.
 * Supports common glob patterns: *, **, ?, [abc], [a-z], {a,b}
 *
 * @param pattern - The glob pattern to match against
 * @returns A function that tests paths against the pattern
 */
export function createMatcher(pattern: string): (path: string) => boolean {
  // Use Bun's native Glob for best performance when available
  if (isBun && Bun?.Glob) {
    const glob = new Bun.Glob(pattern);
    return (path: string) => glob.match(path);
  }

  // Fallback to minimal glob implementation for Node.js
  return createMinimalMatcher(pattern);
}

/**
 * Minimal glob pattern matcher for Node.js environments.
 * Converts glob patterns to RegExp for matching.
 */
function createMinimalMatcher(pattern: string): (path: string) => boolean {
  // Convert glob pattern to regex
  const regex = globToRegex(pattern);
  return (path: string) => regex.test(path);
}

/**
 * Converts a glob pattern to a regular expression.
 * Handles common glob patterns used in file watching.
 */
function globToRegex(glob: string): RegExp {
  let regex = '';
  let inClass = false;
  let inBrace = false;
  let braceLevel = 0;

  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    const nextChar = glob[i + 1];

    if (inClass) {
      // Inside character class [...]
      if (char === ']' && i > 0 && glob[i - 1] !== '\\') {
        inClass = false;
        regex += char;
      } else if (char === '-' && i > 0 && nextChar && nextChar !== ']') {
        // Range in character class
        regex += char;
      } else {
        regex += escapeRegexChar(char);
      }
      continue;
    }

    if (inBrace) {
      // Inside brace expansion {...}
      if (char === '}') {
        braceLevel--;
        if (braceLevel === 0) {
          inBrace = false;
          regex += ')';
        } else {
          regex += '}';
        }
      } else if (char === '{') {
        braceLevel++;
        regex += '{';
      } else if (char === ',' && braceLevel === 1) {
        regex += '|';
      } else {
        regex += escapeRegexChar(char);
      }
      continue;
    }

    switch (char) {
      case '*':
        if (nextChar === '*') {
          // ** matches any number of directories (including zero)
          const prevChar = glob[i - 1];
          const nextNextChar = glob[i + 2];

          if (
            (prevChar === '/' || prevChar === undefined) &&
            (nextNextChar === '/' || nextNextChar === undefined)
          ) {
            // Handle **/ pattern - match zero or more path segments
            if (nextNextChar === '/') {
              // Skip the / after ** and make it optional
              regex += '(?:.*/)?';
              i += 2; // Skip ** and /
            } else {
              // Standalone ** at the end
              regex += '.*';
              i++; // Skip the second *
            }
          } else {
            // Regular * in other contexts
            regex += '[^/]*';
          }
        } else {
          // * matches anything except path separator
          regex += '[^/]*';
        }
        break;

      case '?':
        // ? matches any single character except path separator
        regex += '[^/]';
        break;

      case '[':
        // Start of character class
        inClass = true;
        regex += '[';
        // Handle negation
        if (nextChar === '!' || nextChar === '^') {
          regex += '^';
          i++;
        }
        break;

      case '{':
        // Start of brace expansion
        inBrace = true;
        braceLevel = 1;
        regex += '(';
        break;

      case '/':
        // Path separator
        regex += '\\/';
        break;

      case '.':
      case '(':
      case ')':
      case '+':
      case '|':
      case '^':
      case '$':
      case '\\':
        // Escape regex special characters
        regex += `\\${char}`;
        break;

      default:
        regex += char;
    }
  }

  // Anchor the pattern
  return new RegExp(`^${regex}$`);
}

/**
 * Escapes special regex characters in a string.
 */
function escapeRegexChar(char: string): string {
  const specialChars = '.+*?^$()[]{}|\\';
  if (specialChars.includes(char)) {
    return `\\${char}`;
  }
  return char;
}

/**
 * Legacy compatibility function to match picomatch API.
 * Creates a matcher function from a pattern.
 *
 * @param pattern - The glob pattern
 * @returns A function that tests paths against the pattern
 */
export default function picomatch(pattern: string): (path: string) => boolean {
  return createMatcher(pattern);
}
