export type FormatterKind = 'auto' | 'none' | 'swift' | 'ts';

/**
 * Format test output into a concise summary line.
 * Returns the original lines when no formatter applies.
 */
export function formatTestOutput(
  lines: string[],
  formatter: FormatterKind = 'auto',
  command?: string
): string[] {
  const sanitized = sanitizeLines(lines);
  const effective = resolveFormatter(formatter, command);
  if (effective === 'none' || !effective) return lines;

  if (effective === 'swift') {
    const summary = summarizeSwift(sanitized);
    return summary ? [summary] : sanitized;
  }
  if (effective === 'ts') {
    const summary = summarizeTs(sanitized);
    return summary ? [summary] : sanitized;
  }
  return lines;
}

function sanitizeLines(lines: string[]): string[] {
  return lines.map((l) =>
    l
      // Drop ANSI escapes
      .replace(/[\\u001b]\[[0-?]*[ -/]*[@-~]/g, '')
      // Drop leading icons/bullets
      .replace(/^[^\w]+/u, '')
      .trim()
  );
}

function resolveFormatter(formatter: FormatterKind, command?: string): FormatterKind | null {
  if (formatter === 'none') return 'none';
  if (formatter !== 'auto') return formatter;
  if (command) {
    const cmd = command.toLowerCase();
    if (cmd.includes('swift test')) return 'swift';
    if (
      cmd.includes('vitest') ||
      cmd.includes('jest') ||
      cmd.includes('npm test') ||
      cmd.includes('pnpm test')
    )
      return 'ts';
  }
  return null;
}

function summarizeSwift(lines: string[]): string | null {
  // New Swift Testing summary
  const modern = lines.find((l) => /Test run with \d+ tests/i.test(l));
  if (modern) {
    const m = modern.match(/Test run with (\d+) tests.*(passed|failed).*after ([0-9.]+) seconds/i);
    if (m) {
      const tests = m[1];
      const status = m[2].toLowerCase() === 'passed' ? 'PASS' : 'FAIL';
      const duration = m[3];
      const parts = [status, `${tests} tests`, `${duration}s`];
      return parts.join(' · ');
    }
  }

  // Prefer the "Executed X tests..." line
  const exec = [...lines].reverse().find((l) => /Executed\s+\d+\s+tests/i.test(l));
  const suite = [...lines].reverse().find((l) => /Test Suite '.*' (passed|failed)/i.test(l));

  let tests: string | undefined;
  let failures: string | undefined;
  let duration: string | undefined;
  if (exec) {
    const m = exec.match(/Executed\s+(\d+)\s+tests,\s+with\s+(\d+)\s+failures.*in\s+([0-9.]+)/i);
    if (m) {
      tests = m[1];
      failures = m[2];
      duration = m[3];
    }
  }

  const status = failures !== undefined ? (failures === '0' ? 'PASS' : 'FAIL') : suiteStatus(suite);
  if (!status) return null;

  const parts: string[] = [status];
  if (tests !== undefined) parts.push(`${tests} tests`);
  if (failures !== undefined) parts.push(`${failures} fail`);
  if (duration) parts.push(`${duration}s`);

  // Include first failing test if any
  if (status === 'FAIL') {
    const failing = lines.find((l) => /Test Case '.*' failed/i.test(l));
    if (failing) {
      const nameMatch = failing.match(/Test Case '(.*)' failed/i);
      if (nameMatch) parts.push(`(${nameMatch[1]})`);
    }
  }

  return parts.join(' · ');
}

function summarizeTs(lines: string[]): string | null {
  // Look for "Tests: X failed, Y passed" and "Time:"
  const testsLine = lines.find((l) => /Tests:\s+/i.test(l));
  const timeLine = lines.find((l) => /Time:\s+/i.test(l));

  let status: 'PASS' | 'FAIL' | null = null;
  let summary = '';

  if (testsLine) {
    const m = testsLine.match(/Tests:\s+(.*)/i);
    if (m) summary = m[1].trim();
    if (/failed\s*[,|]/i.test(testsLine) && !/0\s+failed/i.test(testsLine)) status = 'FAIL';
    else status = 'PASS';
  }

  const time = timeLine ? timeLine.replace(/.*Time:\s*/i, '').trim() : '';

  const parts = [];
  if (status) parts.push(status);
  if (summary) parts.push(summary.replace(/\s+/g, ' '));
  if (time) parts.push(time);

  return parts.length > 0 ? parts.join(' · ') : null;
}

function suiteStatus(line?: string): 'PASS' | 'FAIL' | null {
  if (!line) return null;
  if (/passed/i.test(line)) return 'PASS';
  if (/failed/i.test(line)) return 'FAIL';
  return null;
}
