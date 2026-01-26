import { afterEach, describe, expect, it, vi } from 'vitest';
import { Display } from './display.js';

const stripAnsi = (value: string): string => value.replace(/\x1B\[[0-9;]*m/g, '');

describe('Display', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints single-digit codex issue numbers without extra padding', () => {
    const display = new Display({ jsonMode: false }) as unknown as {
      printCodexItemsTable: (
        items: Array<{ level: string; description: string }>,
        levelWidth: number
      ) => void;
    };
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });

    const items = [
      { level: 'major', description: 'Runtime and Python version unspecified; I/O unclear' },
      { level: 'major', description: 'Empty, whitespace, and non-ASCII names undefined' },
      { level: 'minor', description: 'Misspelling; smiley type and encoding unclear' },
    ];
    const levelWidth = Math.max(4, ...items.map(item => item.level.length));

    display.printCodexItemsTable(items, levelWidth);

    const output = logs.map(stripAnsi).join('\n');
    expect(output).toMatchInlineSnapshot(`
"#1  major    Runtime and Python version unspecified; I/O unclear
#2  major    Empty, whitespace, and non-ASCII names undefined
#3  minor    Misspelling; smiley type and encoding unclear"
    `);
  });
});
