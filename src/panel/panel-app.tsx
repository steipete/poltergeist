import { useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { StatusPanelController } from './panel-controller.js';
import type { PanelSnapshot, TargetPanelEntry } from './types.js';

function formatRelativeTime(timestamp?: string): string {
  if (!timestamp) return '—';
  const delta = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.max(0, Math.floor(delta / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(durationMs?: number): string {
  if (!durationMs) return '—';
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  const seconds = Math.round(durationMs / 1000);
  return `${seconds}s`;
}

function statusColor(status?: string): { color: string; label: string } {
  switch (status) {
    case 'success':
      return { color: 'green', label: 'success' };
    case 'failure':
      return { color: 'red', label: 'failed' };
    case 'building':
      return { color: 'yellow', label: 'building' };
    case 'watching':
      return { color: 'blue', label: 'watching' };
    default:
      return { color: 'gray', label: status || 'unknown' };
  }
}

function TargetRow({
  entry,
  selected,
}: {
  entry: TargetPanelEntry;
  selected: boolean;
}) {
  const status = entry.status.lastBuild?.status || entry.status.status || 'unknown';
  const { color, label } = statusColor(status);

  return (
    <Box flexDirection="row">
      <Box width={20}>
        <Text color={selected ? 'cyan' : undefined}>{entry.name}</Text>
        {!entry.enabled ? <Text color="gray"> (disabled)</Text> : null}
      </Box>
      <Box width={12}>
        <Text color={color}>{label}</Text>
      </Box>
      <Box width={18}>
        <Text>{formatRelativeTime(entry.status.lastBuild?.timestamp)}</Text>
      </Box>
      <Box width={12}>
        <Text>{formatDuration(entry.status.lastBuild?.duration)}</Text>
      </Box>
      <Box width={10}>
        <Text>{entry.status.pendingFiles ?? 0}</Text>
      </Box>
      <Box flexGrow={1}>
        {entry.status.process?.isActive ? (
          <Text color="green">pid {entry.status.process.pid}</Text>
        ) : (
          <Text color="gray">idle</Text>
        )}
      </Box>
    </Box>
  );
}

function useTerminalSize(): { columns: number; rows: number } {
  const [size, setSize] = useState(() => ({
    columns: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  }));

  useEffect(() => {
    if (!process.stdout.isTTY) return;
    const handler = () => {
      setSize({
        columns: process.stdout.columns ?? size.columns,
        rows: process.stdout.rows ?? size.rows,
      });
    };
    process.stdout.on('resize', handler);
    return () => {
      process.stdout.off('resize', handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return size;
}

export function PanelApp({ controller }: { controller: StatusPanelController }) {
  const { exit } = useApp();
  const [snapshot, setSnapshot] = useState<PanelSnapshot>(controller.getSnapshot());
  const [selectedIndex, setSelectedIndex] = useState(() => snapshot.preferredIndex ?? 0);
  const [userNavigated, setUserNavigated] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const { rows } = useTerminalSize();

  const logViewport = useMemo(() => {
    if (!rows || rows <= 0) {
      return 10;
    }
    const reservedStaticRows = 12; // headers, separators, spacing, controls
    const reservedByTargets = snapshot.targets.length;
    const available = rows - (reservedStaticRows + reservedByTargets);
    return Math.max(3, available);
  }, [rows, snapshot.targets.length]);

  useEffect(() => {
    return controller.onUpdate((next) => {
      setSnapshot(next);
      if (!userNavigated) {
        setSelectedIndex(next.preferredIndex ?? 0);
      } else if (selectedIndex >= next.targets.length) {
        setSelectedIndex(Math.max(0, next.targets.length - 1));
      }
    });
  }, [controller, selectedIndex, userNavigated]);

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      controller.dispose();
      exit();
      return;
    }
    if (input === 'r') {
      void controller.forceRefresh();
      return;
    }
    if (key.upArrow) {
      setUserNavigated(true);
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setUserNavigated(true);
      setSelectedIndex((prev) => {
        if (snapshot.targets.length === 0) {
          return 0;
        }
        return Math.min(snapshot.targets.length - 1, prev + 1);
      });
    }
  });

  const selectedEntry = snapshot.targets[selectedIndex];
  const shouldTailLogs =
    selectedEntry &&
    (selectedEntry.status.lastBuild?.status === 'building' ||
      selectedEntry.status.lastBuild?.status === 'failure');

  useEffect(() => {
    let cancelled = false;
    if (!selectedEntry || !shouldTailLogs) {
      setLogLines([]);
      return;
    }

    const refreshLogs = async () => {
      const lines = await controller.getLogLines(selectedEntry.name, logViewport + 2);
      if (!cancelled) {
        setLogLines(lines);
      }
    };

    void refreshLogs();

    let interval: NodeJS.Timeout | undefined;
    if (selectedEntry.status.lastBuild?.status === 'building') {
      interval = setInterval(() => {
          void refreshLogs();
      }, 1000);
    }

    return () => {
      cancelled = true;
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [controller, selectedEntry, shouldTailLogs, logViewport]);

  const displayedLogLines = useMemo(() => {
    if (!shouldTailLogs) {
      return [];
    }
    return logLines.slice(-logViewport);
  }, [logLines, logViewport, shouldTailLogs]);

  const gitSummary = useMemo(() => {
    const dirty = snapshot.git.dirtyFiles;
    const delta = snapshot.git.insertions + snapshot.git.deletions;
    if (!snapshot.git.hasRepo) {
      return 'Not a git repository';
    }
    return `Dirty files: ${dirty}  |  ΔLOC: +${snapshot.git.insertions} / -${snapshot.git.deletions} (total ${delta})`;
  }, [snapshot.git]);

  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <Box flexDirection="column">
        <Text>
          {snapshot.projectName} — {snapshot.projectRoot}
        </Text>
        <Text color="gray">
          Branch: {snapshot.git.branch ?? 'unknown'} | {gitSummary}
        </Text>
        <Text color="gray">
          Builds: {snapshot.summary.building} building · {snapshot.summary.failures} failed ·{' '}
          {snapshot.summary.running} daemons running · total {snapshot.summary.totalTargets}
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="row">
          <Box width={20}>
            <Text color="gray">Target</Text>
          </Box>
          <Box width={12}>
            <Text color="gray">Status</Text>
          </Box>
          <Box width={18}>
            <Text color="gray">Last Build</Text>
          </Box>
          <Box width={12}>
            <Text color="gray">Duration</Text>
          </Box>
          <Box width={10}>
            <Text color="gray">Pending</Text>
          </Box>
          <Box flexGrow={1}>
            <Text color="gray">Process</Text>
          </Box>
        </Box>
        <Text color="gray">{'='.repeat(Math.max(40, process.stdout.columns ?? 80))}</Text>
        <Box flexDirection="column">
          {snapshot.targets.length === 0 ? (
            <Text color="gray">No targets configured.</Text>
          ) : (
            snapshot.targets.map((entry, index) => (
              <TargetRow key={entry.name} entry={entry} selected={index === selectedIndex} />
            ))
          )}
        </Box>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text>
          Logs — {selectedEntry ? selectedEntry.name : 'No target selected'}{' '}
          {selectedEntry?.status.lastBuild?.status
            ? `(${selectedEntry.status.lastBuild.status})`
            : ''}
        </Text>
        <Text color="gray">{'='.repeat(Math.max(40, process.stdout.columns ?? 80))}</Text>
        {shouldTailLogs ? (
          displayedLogLines.length > 0 ? (
            displayedLogLines.map((line, idx) => (
              <Text key={`${line}-${idx}`} color="gray">
                {line}
              </Text>
            ))
          ) : (
            <Text color="gray">No log output yet…</Text>
          )
        ) : (
          <Text color="gray">Logs are shown when the selected target is building or failed.</Text>
        )}
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Controls: ↑/↓ move · r refresh · q quit</Text>
      </Box>
    </Box>
  );
}
