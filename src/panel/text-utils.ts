import { visibleWidth } from '@mariozechner/pi-tui';

export function pad(text: string, width: number): string {
  const length = visibleWidth(text);
  if (length >= width) {
    return text;
  }
  return `${text}${' '.repeat(width - length)}`;
}

export function centerText(text: string, width?: number): string {
  if (!width) return text;
  const length = visibleWidth(text);
  if (length >= width) {
    return text;
  }
  const totalPad = width - length;
  const left = Math.floor(totalPad / 2);
  const right = totalPad - left;
  return `${' '.repeat(left)}${text}${' '.repeat(right)}`;
}

export function boxLines(lines: string[], maxWidth?: number): string {
  if (lines.length === 0) return '';
  const widestLine = Math.max(...lines.map((line) => visibleWidth(line)));
  const boxWidth = maxWidth ? Math.max(4, maxWidth) : Math.max(4, widestLine + 2);
  const contentWidth = boxWidth - 2;
  const top = `┌${'─'.repeat(contentWidth)}┐`;
  const bottom = `└${'─'.repeat(contentWidth)}┘`;
  const body = lines.map((line) => `│${pad(line, contentWidth)}│`);
  return [top, ...body, bottom].join('\n');
}

export function countLines(text: string): number {
  if (!text) {
    return 0;
  }
  return text.split('\n').length;
}

export function limitSummaryLines(text: string, maxLines: number): string {
  if (maxLines <= 0) return '';
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  // Truncate without ellipsis—panel already shows only the available vertical space.
  return lines.slice(0, maxLines).join('\n');
}

export function truncateVisible(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  const length = visibleWidth(text);
  if (length <= maxWidth) return text;
  if (maxWidth <= 1) return '…'.slice(0, maxWidth);
  const target = maxWidth - 1;
  let acc = '';
  let used = 0;
  for (const char of text) {
    const w = visibleWidth(char);
    if (used + w > target) {
      break;
    }
    acc += char;
    used += w;
  }
  return `${acc}…`;
}

export { visibleWidth };
