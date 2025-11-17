import type { PoltergeistConfig } from '../types.js';
import type { TargetPanelEntry } from './types.js';

export interface TargetDiff {
  added: string[];
  removed: string[];
}

export function diffTargets(
  currentTargets: TargetPanelEntry[],
  nextTargets: PoltergeistConfig['targets']
): TargetDiff {
  const currentNames = new Set(currentTargets.map((t) => t.name));
  const nextNames = new Set(nextTargets.map((t) => t.name));

  const added: string[] = [];
  const removed: string[] = [];

  for (const name of nextNames) {
    if (!currentNames.has(name)) added.push(name);
  }
  for (const name of currentNames) {
    if (!nextNames.has(name)) removed.push(name);
  }

  return { added, removed };
}
