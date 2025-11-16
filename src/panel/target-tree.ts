import type { TargetPanelEntry } from './types.js';

export type TargetRowConnector = 'root' | 'single' | 'middle' | 'last';

export interface TargetRow {
  target: TargetPanelEntry;
  depth: number;
  connector: TargetRowConnector;
}

/**
 * Flatten targets into a stable, grouped tree. Parent rows are real targets; children
 * reference a parent via `group`. Ordering honors the first time we see a group name.
 */
export const buildTargetRows = (targets: TargetPanelEntry[]): TargetRow[] => {
  type Bucket = { header?: TargetPanelEntry; children: TargetPanelEntry[]; order: number };
  const groups = new Map<string, Bucket>();
  const standalone: TargetPanelEntry[] = [];
  const headerCandidates = new Map<string, TargetPanelEntry>();
  const usedHeaders = new Set<string>();
  let order = 0;

  const touchBucket = (group: string): Bucket => {
    const existing = groups.get(group);
    if (existing) return existing;
    const bucket: Bucket = { header: undefined, children: [], order: order++ };
    groups.set(group, bucket);
    return bucket;
  };

  targets.forEach((target) => {
    if (!target.group) {
      standalone.push(target);
      headerCandidates.set(target.name, target);
      return;
    }
    const bucket = touchBucket(target.group);
    if (target.name === target.group) {
      bucket.header = target;
    } else {
      bucket.children.push(target);
    }
  });

  // Promote header candidates when children reference them.
  groups.forEach((bucket, groupName) => {
    if (!bucket.header) {
      const candidate = headerCandidates.get(groupName);
      if (candidate) {
        bucket.header = candidate;
        usedHeaders.add(candidate.name);
      }
    }
  });

  const standaloneFiltered = standalone.filter((target) => !usedHeaders.has(target.name));

  const rows: TargetRow[] = [];

  // Preserve original appearance order for standalone targets.
  standaloneFiltered.forEach((target) => {
    rows.push({
      target,
      depth: 0,
      connector: 'root',
    });
  });

  // Emit grouped targets in first-seen order.
  Array.from(groups.entries())
    .sort((a, b) => a[1].order - b[1].order)
    .forEach(([, bucket]) => {
      const header = bucket.header ?? bucket.children[0];
      if (header) {
        rows.push({ target: header, depth: 0, connector: 'root' });
      }
      const children = header
        ? bucket.children.filter((child) => child !== header)
        : bucket.children;
      children.forEach((child, idx) => {
        const connector: TargetRowConnector =
          children.length === 1 ? 'single' : idx === children.length - 1 ? 'last' : 'middle';
        rows.push({ target: child, depth: 1, connector });
      });
    });

  return rows;
};
