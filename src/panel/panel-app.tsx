import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { Box, Text, useApp, useInput, measureElement } from 'ink';
import type { StatusPanelController } from './panel-controller.js';
import type {
  PanelSnapshot,
  PanelStatusScriptResult,
  TargetPanelEntry,
} from './types.js';

interface MarkdownSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

function parseInlineMarkdown(text: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|_[^_]+_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index) });
    }
    const token = match[0];
    if ((token.startsWith('**') && token.endsWith('**')) || (token.startsWith('__') && token.endsWith('__'))) {
      segments.push({ text: token.slice(2, -2), bold: true });
    } else if (
      (token.startsWith('*') && token.endsWith('*')) ||
      (token.startsWith('_') && token.endsWith('_'))
    ) {
      segments.push({ text: token.slice(1, -1), italic: true });
    } else if (token.startsWith('`') && token.endsWith('`')) {
      segments.push({ text: token.slice(1, -1), code: true });
    } else {
      segments.push({ text: token });
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex) });
  }
  return segments;
}

function MarkdownLine({ line }: { line: string }): JSX.Element | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  const bulletMatch = trimmed.match(/^([-*+])\s+/);
  const bullet = bulletMatch ? '•' : '';
  const content = bulletMatch ? trimmed.slice(bulletMatch[0].length) : trimmed;
  const segments = parseInlineMarkdown(content);

  return (
    <Text>
      {bullet ? <Text color={palette.header}>{`${bullet} `}</Text> : null}
      {segments.map((segment, index) => (
        <Text
          // eslint-disable-next-line react/no-array-index-key
          key={`markdown-segment-${index}`}
          color={segment.code ? palette.accent : undefined}
          bold={segment.bold}
          italic={segment.italic}
        >
          {segment.text}
        </Text>
      ))}
    </Text>
  );
}

function MarkdownSummary({ lines }: { lines: string[] }): JSX.Element {
  return (
    <Box flexDirection="column" marginTop={0}>
      {lines.map((line, index) => (
        <MarkdownLine key={`ai-summary-${index}`} line={line} />
      ))}
    </Box>
  );
}

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

function formatDurationShort(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  if (seconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${seconds}s`;
}

function scriptColorFromExitCode(exitCode?: number | null): string {
  if (!exitCode || exitCode <= 0) {
    return palette.success;
  }
  return palette.failure;
}

function postBuildColor(status?: string): string {
  switch (status) {
    case 'success':
      return palette.success;
    case 'failure':
      return palette.failure;
    case 'running':
      return palette.warning;
    default:
      return palette.info;
  }
}

function groupDirtyFiles(files: string[]): Array<{ dir: string; files: string[] }> {
  const limit = files.slice(0, 10);
  const groups = new Map<string, string[]>();
  for (const path of limit) {
    const lastSlash = path.lastIndexOf('/');
    const dir = lastSlash >= 0 ? path.slice(0, lastSlash) : '';
    const fileName = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
    const existing = groups.get(dir) ?? [];
    existing.push(fileName);
    groups.set(dir, existing);
  }
  return Array.from(groups.entries()).map(([dir, groupFiles]) => ({ dir, files: groupFiles }));
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

function TargetRow({ entry, selected }: { entry: TargetPanelEntry; selected: boolean }) {
  const status = entry.status.lastBuild?.status || entry.status.status || 'unknown';
  const { color, label } = statusColor(status);
  const pending = entry.status.pendingFiles ?? 0;

  return (
    <Box flexDirection="row">
      <Box width={34}>
        <Text color={selected ? palette.accent : undefined}>{entry.name}</Text>
        {!entry.enabled ? <Text color={palette.header}> (disabled)</Text> : null}
      </Box>
      <Box width={20}>
        <Text color={color}>
          {label}
          {pending > 0 ? ` · +${pending} queued` : ''}
        </Text>
      </Box>
      <Box width={16}>
        <Text>{formatRelativeTime(entry.status.lastBuild?.timestamp)}</Text>
      </Box>
      <Box width={10}>
        <Text>{formatDuration(entry.status.lastBuild?.duration)}</Text>
      </Box>
      <Box flexGrow={1} />
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
  const logContainerRef = useRef<Parameters<typeof measureElement>[0] | null>(null);
  const [logHeight, setLogHeight] = useState(0);

  useLayoutEffect(() => {
    if (!logContainerRef.current) return;
    const measurement = measureElement(logContainerRef.current);
    const next = Math.max(0, Math.floor(measurement?.height ?? 0));
    if (next !== logHeight) {
      setLogHeight(next);
    }
  }, [rows, columns, snapshot.targets.length]);

  const controlsLine = 'Controls: ↑/↓ move · r refresh · q quit';
  const parsedAiSummary = useMemo(() => {
    const lines = [...(snapshot.git.summary ?? [])];
    let detectedHeader: string | null = null;

    const firstIndex = lines.findIndex((line) => line.trim().length > 0);
    if (firstIndex !== -1) {
      const rawLine = lines[firstIndex].trim();
      const headerMatch = rawLine.match(/^(?![-*+])([^:]{3,80}):\s*(.*)$/);
      if (headerMatch) {
        detectedHeader = `${headerMatch[1].trim()}:`;
        const remainder = headerMatch[2]?.trim() ?? '';
        if (remainder.length > 0) {
          lines[firstIndex] = remainder;
        } else {
          lines.splice(firstIndex, 1);
        }
      }
    }

    return {
      lines,
      header: detectedHeader,
    };
  }, [snapshot.git.summary]);
  const hasAiSummary = parsedAiSummary.header !== null || parsedAiSummary.lines.length > 0;
  const activeDaemons = snapshot.summary.activeDaemons ?? [];
  const formattedDaemonIds = activeDaemons.map((id) => {
    if (id.startsWith('target:')) {
      return id.replace(/^target:/, '');
    }
    return /^\d+$/.test(id) ? `PID ${id}` : id;
  });
  const daemonLabelText =
    snapshot.summary.running === 1 ? 'daemon running' : 'daemons running';
  const daemonSuffix =
    formattedDaemonIds.length > 0 ? ` (${formattedDaemonIds.join(', ')})` : '';

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
      return;
    }
  });

  const selectedEntry = snapshot.targets[selectedIndex];
  const shouldTailLogs =
    selectedEntry &&
    (selectedEntry.status.lastBuild?.status === 'building' ||
      selectedEntry.status.lastBuild?.status === 'failure');

  const logTextCapacity =
    logHeight > 0 ? Math.max(1, Math.min(10, logHeight - 2)) : 0;

  useEffect(() => {
    let cancelled = false;
    if (!selectedEntry || !shouldTailLogs) {
      setLogLines([]);
      return;
    }

    const refreshLogs = async () => {
      const lines = await controller.getLogLines(selectedEntry.name, logTextCapacity + 2);
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
  }, [controller, selectedEntry, shouldTailLogs, logTextCapacity]);

  const displayedLogLines = useMemo(() => {
    if (!shouldTailLogs || logTextCapacity <= 0) {
      return [];
    }
    const sliceStart = Math.max(0, logLines.length - logTextCapacity);
    return logLines.slice(sliceStart);
  }, [logLines, logTextCapacity, shouldTailLogs]);
  const hasLogLines = shouldTailLogs && displayedLogLines.length > 0;

  const statusScriptsByTarget = useMemo(() => {
    const targetMap = new Map<string, PanelStatusScriptResult[]>();
    const global: PanelStatusScriptResult[] = [];
    (snapshot.statusScripts ?? []).forEach((script) => {
      if (script.targets?.length) {
        script.targets.forEach((target) => {
          const list = targetMap.get(target) ?? [];
          targetMap.set(target, [...list, script]);
        });
      } else {
        global.push(script);
      }
    });
    return { targetMap, global };
  }, [snapshot.statusScripts]);

  const dirtyFileGroups = useMemo(
    () => groupDirtyFiles(snapshot.git.dirtyFileNames ?? []),
    [snapshot.git.dirtyFileNames]
  );

  const horizontalRule = '─'.repeat(Math.max(20, columns - 2));

  return (
    <Box
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      height={rows || undefined}
      minHeight={0}
    >
      <Box flexDirection="column" flexShrink={0} minHeight={0}>
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
          {snapshot.summary.running} {daemonLabelText}
          {daemonSuffix} · total {snapshot.summary.totalTargets}
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1} flexShrink={0} minHeight={0}>
        <Box flexDirection="row">
          <Box width={34}>
            <Text color={palette.header}>Target</Text>
          </Box>
          <Box width={14}>
            <Text color={palette.header}>Status</Text>
          </Box>
          <Box width={16}>
            <Text color={palette.header}>Last Build</Text>
          </Box>
          <Box width={10}>
            <Text color={palette.header}>Duration</Text>
          </Box>
          <Box flexGrow={1} />
        </Box>
        <Text color={palette.line}>{horizontalRule}</Text>
        <Box flexDirection="column">
          {snapshot.targets.length === 0 ? (
            <Text color={palette.header}>No targets configured.</Text>
          ) : (
            snapshot.targets.map((entry, index) => (
              <Fragment key={entry.name}>
                <TargetRow entry={entry} selected={index === selectedIndex} />
                {statusScriptsByTarget.targetMap.get(entry.name)?.map((script, idx) => {
                  const scriptColor = scriptColorFromExitCode(script.exitCode);
                  return (
                    <Box key={`${script.label}-${idx}`} flexDirection="column" paddingLeft={2}>
                      {script.lines.length === 0 ? (
                        <Text color={scriptColor}>
                          {script.label}: (no output) [{formatDurationShort(script.durationMs)}]
                        </Text>
                      ) : (
                        script.lines.map((line, lineIndex) => (
                          <Text key={`${script.label}-${idx}-${lineIndex}`} color={scriptColor}>
                            {lineIndex === 0
                              ? `${script.label}: ${line} [${formatDurationShort(script.durationMs)}]`
                              : `  ${line}`}
                          </Text>
                        ))
                      )}
                    </Box>
                  );
                })}
                {Array.isArray(entry.status.postBuild) &&
                  entry.status.postBuild.map((result, idx) => {
                    const testColor = postBuildColor(result.status);
                    const durationTag =
                      result.durationMs !== undefined
                        ? ` [${formatDurationShort(result.durationMs)}]`
                        : '';
                    const summary =
                      result.summary ||
                      `${result.name}: ${result.status ?? 'pending'}`.replace(/\s+/g, ' ');
                    return (
                      <Box key={`${entry.name}-test-${idx}`} flexDirection="column" paddingLeft={2}>
                        <Text color={testColor}>
                          {summary}
                          {durationTag}
                        </Text>
                        {result.lines?.map((line, lineIndex) => (
                          <Text
                            key={`${entry.name}-test-${idx}-${lineIndex}`}
                            color={testColor}
                          >
                            {lineIndex === 0 ? `  ${line}` : `  ${line}`}
                          </Text>
                        ))}
                      </Box>
                    );
                  })}
              </Fragment>
            ))
          )}
        </Box>
      </Box>
      <Box>
        <Text color={palette.line}>{horizontalRule}</Text>
      </Box>
      {dirtyFileGroups.length && !hasAiSummary ? (
        <Box flexDirection="column" marginTop={1} flexShrink={0}>
          <Text color={palette.header}>
            Dirty Files ({Math.min(snapshot.git.dirtyFileNames.length, 10)}
            {snapshot.git.dirtyFiles > snapshot.git.dirtyFileNames.length
              ? ` of ${snapshot.git.dirtyFiles}`
              : ''}
            ):
          </Text>
          {dirtyFileGroups.map((group, index) => (
            <Text key={`${group.dir}-${index}`} color={palette.muted}>
              •{' '}
              {group.files.length === 1
                ? group.dir
                  ? `${group.dir}/${group.files[0]}`
                  : group.files[0]
                : `${group.dir || '.'}: ${group.files.join(', ')}`}
            </Text>
          ))}
          {snapshot.git.dirtyFiles > 10 && (
            <Text color={palette.muted}>
              …and {snapshot.git.dirtyFiles - 10} more
            </Text>
          )}
        </Box>
      ) : null}
      {hasAiSummary ? (
        <Box flexDirection="column" marginTop={1} flexShrink={0}>
          {parsedAiSummary.header ? (
            <Text color={palette.header}>{parsedAiSummary.header}</Text>
          ) : (
            <Text color={palette.header}>AI summary of changed files:</Text>
          )}
          {parsedAiSummary.lines.length > 0 ? (
            <MarkdownSummary lines={parsedAiSummary.lines} />
          ) : null}
        </Box>
      ) : null}
      {statusScriptsByTarget.global.length > 0 && (
        <Box flexDirection="column" marginTop={1} flexShrink={0}>
          {statusScriptsByTarget.global.map((script, index) => {
            const scriptColor = scriptColorFromExitCode(script.exitCode);
            return (
              <Box key={`${script.label}-${index}`} flexDirection="column">
                {script.lines.length === 0 ? (
                  <Text color={scriptColor}>
                    {script.label}: (no output) [{formatDurationShort(script.durationMs)}]
                  </Text>
                ) : (
                  script.lines.map((line, lineIndex) => (
                    <Text key={`${script.label}-${index}-${lineIndex}`} color={scriptColor}>
                      {lineIndex === 0
                        ? `${script.label}: ${line} [${formatDurationShort(script.durationMs)}]`
                        : `  ${line}`}
                    </Text>
                  ))
                )}
              </Box>
            );
          })}
        </Box>
      )}
      {hasLogLines ? (
        <>
          <Box marginTop={1}>
            <Text color={palette.line}>{horizontalRule}</Text>
          </Box>
          <Box
            ref={logContainerRef}
            flexDirection="column"
            flexGrow={1}
            minHeight={3}
            minWidth={0}
            marginTop={1}
          >
            <Text color={palette.header}>
              Logs — {selectedEntry ? selectedEntry.name : 'No target selected'}{' '}
              {selectedEntry?.status.lastBuild?.status
                ? `(${selectedEntry.status.lastBuild.status})`
                : ''}
            </Text>
            <Text color={palette.line}>{horizontalRule}</Text>
            <Box flexGrow={1} flexDirection="column">
              {displayedLogLines.map((line, idx) => (
                <Text key={`${line}-${idx}`} color={palette.header}>
                  {line}
                </Text>
              ))}
            </Box>
          </Box>
        </>
      ) : null}
      <Box flexDirection="row" justifyContent="space-between" flexShrink={0} minHeight={0}>
        <Text color={palette.header}>{controlsLine}</Text>
      </Box>
    </Box>
  );
}
