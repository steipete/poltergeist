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

const palette = {
  accent: '#8BE9FD',
  header: '#2EE6FF',
  text: '#F8F8F2',
  muted: '#8E95B3',
  line: '#5C6080',
  success: '#50FA7B',
  failure: '#FF5555',
  warning: '#F1FA8C',
  info: '#AEB1C2',
};

function statusColor(status?: string): { color: string; label: string } {
  switch (status) {
    case 'success':
      return { color: palette.success, label: 'success' };
    case 'failure':
      return { color: palette.failure, label: 'failed' };
    case 'building':
      return { color: palette.warning, label: 'building' };
    case 'watching':
      return { color: palette.accent, label: 'watching' };
    default:
      return { color: palette.info, label: status || 'unknown' };
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
      <Box width={28}>
        <Text color={selected ? palette.accent : undefined}>{entry.name}</Text>
        {!entry.enabled ? <Text color={palette.header}> (disabled)</Text> : null}
      </Box>
      <Box width={16}>
        <Text color={color}>{label}</Text>
      </Box>
      <Box width={18}>
        <Text>{formatRelativeTime(entry.status.lastBuild?.timestamp)}</Text>
      </Box>
      <Box width={12}>
        <Text>{formatDuration(entry.status.lastBuild?.duration)}</Text>
      </Box>
      <Box width={8}>
        <Text>{entry.status.pendingFiles ?? 0}</Text>
      </Box>
      <Box flexGrow={1}>
        {entry.status.process?.isActive ? (
          <Text color={palette.success}>pid {entry.status.process.pid}</Text>
        ) : (
          <Text color={palette.header}>idle</Text>
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
  const { rows, columns } = useTerminalSize();

  const logViewport = useMemo(() => {
    if (!rows || rows <= 0) {
      return 10;
    }
    const headerRows = 5; // title + two info lines + spacing
    const tableHeaderRows = 3; // columns + separator + spacing
    const targetRows = snapshot.targets.length;
    const controlsRows = 1;
    const padding = 3; // blank lines / breathing room
    const available = rows - (headerRows + tableHeaderRows + targetRows + controlsRows + padding);
    return Math.max(3, available);
  }, [rows, snapshot.targets.length]);

  const controlsLine = 'Controls: ↑/↓ move · r refresh · q quit';

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

  const logTextCapacity = Math.max(1, logViewport - 2); // minus header + divider inside log box

  const displayedLogLines = useMemo(() => {
    if (!shouldTailLogs) {
      return [];
    }
    return logLines.slice(-logTextCapacity);
  }, [logLines, logTextCapacity, shouldTailLogs]);

  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1} height={rows || undefined}>
      <Box flexDirection="column" flexShrink={0}>
        <Text color={palette.text}>
          {snapshot.projectName} — {snapshot.projectRoot}
        </Text>
        <Text>
          <Text color={palette.muted}>Branch:</Text>{' '}
          <Text color={palette.text}>{snapshot.git.branch ?? 'unknown'}</Text>
          {'  |  '}
          <Text color={palette.muted}>Dirty files:</Text>{' '}
          <Text
            color={
              !snapshot.git.hasRepo
                ? palette.info
                : snapshot.git.dirtyFiles > 0
                  ? palette.failure
                  : palette.success
            }
          >
            {snapshot.git.hasRepo ? snapshot.git.dirtyFiles : 'n/a'}
          </Text>
          {'  |  '}
          <Text color={palette.muted}>ΔLOC:</Text>{' '}
          <Text
            color={
              !snapshot.git.hasRepo
                ? palette.info
                : snapshot.git.insertions > 0
                  ? palette.success
                  : palette.info
            }
          >
            {snapshot.git.hasRepo ? `+${snapshot.git.insertions}` : 'n/a'}
          </Text>{' '}
          <Text color={palette.muted}>/</Text>{' '}
          <Text
            color={
              !snapshot.git.hasRepo
                ? palette.info
                : snapshot.git.deletions > 0
                  ? palette.failure
                  : palette.info
            }
          >
            {snapshot.git.hasRepo ? `-${snapshot.git.deletions}` : 'n/a'}
          </Text>{' '}
          <Text color={palette.muted}>
            ({snapshot.git.hasRepo ? `total ${snapshot.git.insertions + snapshot.git.deletions}` : 'no repo'})
          </Text>
        </Text>
        <Text color={palette.muted}>
          Builds: {snapshot.summary.building} building · {snapshot.summary.failures} failed ·{' '}
          {snapshot.summary.running} daemons running · total {snapshot.summary.totalTargets}
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1} flexShrink={0}>
        <Box flexDirection="row">
          <Box width={28}>
            <Text color={palette.header}>Target</Text>
          </Box>
          <Box width={16}>
            <Text color={palette.header}>Status</Text>
          </Box>
          <Box width={18}>
            <Text color={palette.header}>Last Build</Text>
          </Box>
          <Box width={12}>
            <Text color={palette.header}>Duration</Text>
          </Box>
          <Box width={8}>
            <Text color={palette.header}>Pending</Text>
          </Box>
          <Box flexGrow={1}>
            <Text color={palette.header}>Process</Text>
          </Box>
        </Box>
        <Text color={palette.line}>{'─'.repeat(Math.max(20, columns - 2))}</Text>
        <Box flexDirection="column">
          {snapshot.targets.length === 0 ? (
            <Text color={palette.header}>No targets configured.</Text>
          ) : (
            snapshot.targets.map((entry, index) => (
              <TargetRow key={entry.name} entry={entry} selected={index === selectedIndex} />
            ))
          )}
        </Box>
      </Box>
      <Box flexDirection="column" marginTop={1} flexGrow={1} height={logViewport}>
        <Text color={palette.header}>
          Logs — {selectedEntry ? selectedEntry.name : 'No target selected'}{' '}
          {selectedEntry?.status.lastBuild?.status
            ? `(${selectedEntry.status.lastBuild.status})`
            : ''}
        </Text>
        <Text color={palette.line}>{'─'.repeat(Math.max(20, columns - 2))}</Text>
        <Box flexGrow={1} flexDirection="column">
          {shouldTailLogs ? (
            displayedLogLines.length > 0 ? (
              displayedLogLines.map((line, idx) => (
                <Text key={`${line}-${idx}`} color={palette.header}>
                  {line}
                </Text>
              ))
            ) : (
              <Text color={palette.header}>No log output yet…</Text>
            )
          ) : (
            <Text color={palette.header}>Logs are shown when the selected target is building or failed.</Text>
          )}
        </Box>
      </Box>
      <Box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <Text color={palette.header}>{controlsLine}</Text>
      </Box>
    </Box>
  );
}
