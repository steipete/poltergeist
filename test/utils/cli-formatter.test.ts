import { describe, expect, it } from 'vitest';
import {
  commandGroups,
  commands,
  examples,
  formatCommand,
  formatHelp,
  header,
  options,
  sectionTitle,
  usage,
} from '../../src/utils/cli-formatter.js';

const ESC = String.fromCharCode(27);
const ANSI_REGEX = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
const stripAnsi = (value: string) => value.replace(ANSI_REGEX, '');

describe('cli formatter', () => {
  it('formats headers, sections and usage', () => {
    expect(header('Poltergeist', 'Keeps builds fresh')).toContain('👻');
    expect(sectionTitle('options')).toMatch(/OPTIONS/);
    expect(stripAnsi(usage('poltergeist', 'start --target foo'))).toContain(
      '$ poltergeist start --target foo'
    );
  });

  it('aligns commands with aliases and arguments', () => {
    const cmd = formatCommand(
      { name: 'start', aliases: ['haunt'], args: '<target>', description: 'Start daemon' },
      20
    );
    expect(stripAnsi(cmd)).toMatch(/start, haunt <target>\s+Start daemon/);
  });

  it('renders grouped commands with calculated padding', () => {
    const output = commandGroups([
      {
        title: 'Daemon Control',
        commands: [
          { name: 'start', description: 'Begin watching' },
          { name: 'stop', description: 'Stop daemon' },
        ],
      },
    ]);

    const stripped = stripAnsi(output);
    expect(stripped).toContain('Daemon Control');
    expect(stripped).toMatch(/start\s+Begin watching/);
    expect(stripped).toMatch(/stop\s+Stop daemon/);
  });

  it('formats options and examples with consistent layout', () => {
    const opts = options([
      { flags: '-h, --help', description: 'Show help' },
      { flags: '--verbose', description: 'Verbose logging' },
    ]);
    const ex = examples('poltergeist', [
      { command: 'start --target api', description: 'Watch API target' },
    ]);

    expect(stripAnsi(opts)).toMatch(/-h, --help\s+Show help/);
    expect(stripAnsi(ex)).toContain('$ poltergeist start --target api');
    expect(stripAnsi(ex)).toContain('Watch API target');
  });

  it('formats flat command lists without groups', () => {
    const output = commands([
      { name: 'status', description: 'Show status' },
      { name: 'logs', description: 'Show logs', args: '<target>' },
    ]);
    const stripped = stripAnsi(output);
    expect(stripped).toContain('COMMANDS');
    expect(stripped).toMatch(/status\s+Show status/);
    expect(stripped).toMatch(/logs <target>\s+Show logs/);
  });

  it('produces a full help screen with mixed sections', () => {
    const help = formatHelp({
      title: 'Poltergeist',
      tagline: 'Ghosting stale builds',
      programName: 'poltergeist',
      usage: '<command> [options]',
      commandGroups: [
        {
          title: 'Daemon',
          commands: [{ name: 'start', description: 'Start daemon' }],
        },
      ],
      options: [{ flags: '--verbose', description: 'Verbose output' }],
      examples: [{ command: 'start', description: 'Start with defaults' }],
      additionalSections: [{ title: 'Notes', content: 'Use polter for executions.' }],
    });
    const stripped = stripAnsi(help);

    expect(stripped).toContain('Poltergeist - Ghosting stale builds');
    expect(stripped).toContain('Daemon');
    expect(stripped).toContain('--verbose');
    expect(stripped).toContain('NOTES');
    expect(stripped).toContain('EXAMPLES');
  });
});
