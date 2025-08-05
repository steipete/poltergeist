import chalk from 'chalk';
import type { PoltergeistConfig } from '../types.js';

/**
 * Calculate Levenshtein distance between two strings for fuzzy matching
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  // Initialize first row and column
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Find targets with similar names using fuzzy matching
 */
function findSimilarTargets(targetName: string, availableTargets: string[]): string[] {
  // Calculate distances and sort by similarity
  const suggestions = availableTargets
    .map((target) => ({
      target,
      distance: levenshteinDistance(targetName.toLowerCase(), target.toLowerCase()),
    }))
    .filter(({ distance }) => {
      // More strict threshold: max 3 edits or 30% of length, whichever is smaller
      const maxDistance = Math.min(3, Math.ceil(targetName.length * 0.3));
      return distance <= maxDistance;
    })
    .sort((a, b) => a.distance - b.distance)
    .map(({ target }) => target);

  return suggestions;
}

/**
 * Format available targets for display
 */
export function formatAvailableTargets(config: PoltergeistConfig): string[] {
  return config.targets.map((t) => {
    const status = t.enabled ? '' : chalk.gray(' [disabled]');
    return `  • ${chalk.cyan(t.name)} (${t.type})${status}`;
  });
}

/**
 * Validate target exists and provide helpful error with suggestions
 */
export function validateTarget(targetName: string, config: PoltergeistConfig): void {
  const targetNames = config.targets.map((t) => t.name);

  if (!targetNames.includes(targetName)) {
    console.error(chalk.red(`❌ Target '${targetName}' not found`));
    console.error('');

    // Show available targets
    console.error(chalk.yellow('Available targets:'));
    console.error(formatAvailableTargets(config).join('\n'));

    // Find similar targets
    const suggestions = findSimilarTargets(targetName, targetNames);
    if (suggestions.length > 0) {
      console.error('');

      // Check if we have an exact case-insensitive match
      const exactMatch = suggestions.find((s) => s.toLowerCase() === targetName.toLowerCase());
      if (exactMatch) {
        console.error(chalk.cyan(`Did you mean '${exactMatch}'?`));
      } else if (suggestions.length === 1) {
        console.error(chalk.cyan(`Did you mean '${suggestions[0]}'?`));
      } else {
        console.error(chalk.cyan('Did you mean one of these?'));
        suggestions.forEach((s) => console.error(`  • ${s}`));
      }
    }

    // Show usage example
    console.error('');
    console.error(chalk.gray('Usage: npx poltergeist logs <target> [options]'));
    if (targetNames.length > 0) {
      console.error(chalk.gray(`Example: npx poltergeist logs ${targetNames[0]} --tail 50`));
    }

    process.exit(1);
  }
}

/**
 * Get target if it exists, otherwise show error and exit
 */
export function getTargetOrFail(targetName: string, config: PoltergeistConfig) {
  validateTarget(targetName, config);
  return config.targets.find((t) => t.name === targetName)!;
}
