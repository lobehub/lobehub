import { formatFileContent } from '@lobechat/prompts/fileSystem';
import { truncateToolResult } from '@lobechat/prompts/toolResult';
import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { StaleToolResultTrimProcessor } from '../StaleToolResultTrim';

const LOCAL = 'lobe-local-system';
const SANDBOX = 'lobe-cloud-sandbox';
const SKILLS = 'lobe-skills';

const createContext = (messages: any[]): PipelineContext => ({
  initialState: { messages: [] },
  isAborted: false,
  messages,
  metadata: {},
});

let seq = 0;
const toolMessage = (
  identifier: string,
  apiName: string,
  content: string,
  args: Record<string, unknown> = {},
  overrides?: Record<string, unknown>,
) => ({
  content,
  id: `tool-${apiName}-${++seq}`,
  plugin: { apiName, arguments: JSON.stringify(args), identifier },
  role: 'tool',
  tool_call_id: `call-${apiName}-${seq}`,
  ...overrides,
});

/** Cloud sandbox reads take 1-based inclusive `startLine`/`endLine` and return no `loc`. */
const sandboxRead = (
  path: string,
  content: string,
  range: { endLine?: number; startLine?: number } = {},
  state: Record<string, unknown> = {},
) =>
  toolMessage(
    SANDBOX,
    'readFile',
    content,
    { path, ...range },
    { pluginState: { content, path, ...range, ...state } },
  );

const localRead = (
  path: string,
  content: string,
  loc: [number, number],
  state: Record<string, unknown> = {},
) =>
  toolMessage(LOCAL, 'readFile', content, { loc, path }, { pluginState: { loc, path, ...state } });

const write = (identifier: string, path: string, apiName = 'writeFile') =>
  toolMessage(
    identifier,
    apiName,
    `Successfully wrote to ${path}`,
    { path },
    {
      pluginState: { path, success: true },
    },
  );

const recencyPadding = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    content: `recent ${i}`,
    id: `pad-${i}`,
    role: 'assistant',
  }));

const createProcessor = () =>
  new StaleToolResultTrimProcessor({ keepRecentMessages: 3, minTotalToolChars: 0 });

describe('StaleToolResultTrimProcessor — cloud sandbox and skills tools', () => {
  describe('file supersede rules', () => {
    it.each(['writeFile', 'editFile'])(
      'trims a cloud sandbox readFile superseded by a later %s to the same path',
      async (apiName) => {
        const messages = [
          sandboxRead('/workspace/a.ts', 'x'.repeat(5000)),
          write(SANDBOX, '/workspace/a.ts', apiName),
          ...recencyPadding(3),
        ];

        const result = await createProcessor().process(createContext(messages));

        expect(result.messages[0].content).toBe(
          '[readFile result trimmed: /workspace/a.ts — superseded by a later write to this file. Call readFile again if you need the current content.]',
        );
        expect(result.messages[1].content).toBe(messages[1].content);
        expect(result.metadata.staleToolResultTrim).toMatchObject({
          byRule: { readSupersededByWrite: 1 },
          trimmedMessages: 1,
        });
      },
    );

    it('never lets a local write supersede a sandbox read of the same path, or vice versa', async () => {
      const messages = [
        sandboxRead('/a.ts', 's'.repeat(5000)),
        localRead('/a.ts', 'l'.repeat(5000), [0, 200]),
        write(LOCAL, '/a.ts'),
        ...recencyPadding(3),
      ];

      const result = await createProcessor().process(createContext(messages));

      expect(result.messages[0].content).toBe('s'.repeat(5000));
      expect(result.messages[1].content).toContain('superseded by a later write');
      expect(result.metadata.staleToolResultTrim?.trimmedMessages).toBe(1);
    });

    it('never lets a sandbox re-read cover a local read of the same path', async () => {
      const messages = [
        localRead('/a.ts', 'l'.repeat(5000), [0, 100]),
        sandboxRead('/a.ts', 's'.repeat(6000)),
        ...recencyPadding(3),
      ];

      const result = await createProcessor().process(createContext(messages));

      expect(result.messages[0].content).toBe('l'.repeat(5000));
      expect(result.messages[1].content).toBe('s'.repeat(6000));
    });

    it('treats an omitted sandbox range as a full-file read that covers earlier ranges', async () => {
      const messages = [
        sandboxRead('/a.ts', 'y'.repeat(3000), { endLine: 100, startLine: 1 }),
        sandboxRead('/a.ts', 'z'.repeat(6000)),
        ...recencyPadding(3),
      ];

      const result = await createProcessor().process(createContext(messages));

      expect(result.messages[0].content).toBe(
        '[readFile result trimmed: /a.ts (lines 1-100) — the same range was read again later. Refer to the newer read, or call readFile again if needed.]',
      );
      expect(result.messages[1].content).toBe('z'.repeat(6000));
      expect(result.metadata.staleToolResultTrim?.byRule).toEqual({ readSupersededByRead: 1 });
    });

    it('normalizes 1-based inclusive ranges, so adjacent windows do not cover each other', async () => {
      const messages = [
        sandboxRead('/a.ts', 'first chunk', { endLine: 200, startLine: 1 }),
        sandboxRead('/a.ts', 'second chunk', { endLine: 400, startLine: 201 }),
        ...recencyPadding(3),
      ];

      const result = await createProcessor().process(createContext(messages));

      expect(result.messages[0].content).toBe('first chunk');
      expect(result.messages[1].content).toBe('second chunk');
      expect(result.metadata.staleToolResultTrim?.trimmedMessages ?? 0).toBe(0);
    });

    it('treats a startLine-only sandbox read as running to the end of the file', async () => {
      const messages = [
        sandboxRead('/a.ts', 'm'.repeat(3000), { endLine: 80, startLine: 50 }),
        sandboxRead('/a.ts', 'n'.repeat(6000), { startLine: 10 }),
        ...recencyPadding(3),
      ];

      const result = await createProcessor().process(createContext(messages));

      expect(result.messages[0].content).toContain('(lines 50-80)');
      expect(result.messages[0].content).toContain('the same range was read again later');
    });

    it('keeps an earlier sandbox read when the later re-read is not a superset', async () => {
      const messages = [
        sandboxRead('/a.ts', 'm'.repeat(3000), { startLine: 50 }),
        sandboxRead('/a.ts', 'n'.repeat(6000), { endLine: 500, startLine: 1 }),
        ...recencyPadding(3),
      ];

      const result = await createProcessor().process(createContext(messages));

      expect(result.messages[0].content).toBe('m'.repeat(3000));
    });

    it('never treats a char-capped (truncated) sandbox re-read as covering earlier reads', async () => {
      const messages = [
        sandboxRead('/a.ts', 'y'.repeat(3000), { endLine: 900, startLine: 800 }),
        sandboxRead('/a.ts', 'z'.repeat(6000), {}, { truncated: true }),
        ...recencyPadding(3),
      ];

      const result = await createProcessor().process(createContext(messages));

      expect(result.messages[0].content).toBe('y'.repeat(3000));
      expect(result.metadata.staleToolResultTrim?.trimmedMessages ?? 0).toBe(0);
    });

    it('never treats a truncated local re-read as covering earlier reads', async () => {
      const messages = [
        localRead('/a.ts', 'y'.repeat(3000), [100, 200]),
        localRead('/a.ts', 'z'.repeat(6000), [0, 1000], { truncated: true }),
        ...recencyPadding(3),
      ];

      const result = await createProcessor().process(createContext(messages));

      expect(result.messages[0].content).toBe('y'.repeat(3000));
    });

    it('still trims a truncated sandbox read once the file is written', async () => {
      const messages = [
        sandboxRead('/a.ts', 'z'.repeat(6000), {}, { truncated: true }),
        write(SANDBOX, '/a.ts', 'editFile'),
        ...recencyPadding(3),
      ];

      const result = await createProcessor().process(createContext(messages));

      expect(result.messages[0].content).toContain('superseded by a later write');
    });

    it('labels whole-file and open-ended sandbox ranges in readSupersededByRead placeholders', async () => {
      const messages = [
        sandboxRead('/whole.ts', 'w'.repeat(3000)),
        sandboxRead('/whole.ts', 'w'.repeat(4000)),
        toolMessage(
          SANDBOX,
          'readFile',
          'e'.repeat(3000),
          { path: '/tail.ts', startLine: 50 },
          { pluginState: { path: '/tail.ts' } },
        ),
        sandboxRead('/tail.ts', 'e'.repeat(4000), { startLine: 10 }),
        ...recencyPadding(3),
      ];

      const result = await createProcessor().process(createContext(messages));

      expect(result.messages[0].content).toContain('/whole.ts (whole file)');
      expect(result.messages[2].content).toContain('/tail.ts (lines 50-EOF)');
    });

    it('never treats a re-read cut by the outer tool-result limit as covering earlier reads', async () => {
      const multiLine = Array.from({ length: 100 }, (_, i) => `${i + 1} ${'x'.repeat(20)}`).join(
        '\n',
      );
      const cutMultiLine = truncateToolResult(multiLine, 500);
      const cutSingleLine = truncateToolResult('x'.repeat(2000), 500);
      const archived = `${cutMultiLine}\nFull content archived to the agent-document VFS.\nPath: ./.tool-results/abc.txt\nAgent Document ID: doc-1\nRead it with the lobe-agent-documents tool: apiName=readDocument, id=<Agent Document ID above>, format="markdown", and offset/limit to page by line. Do NOT activate cloud-sandbox or local-system file tools — this archive exists only inside the agent document tree.`;
      const archiveFailed = `${cutMultiLine}\n[Archive failed: disk full. Full content was not persisted.]`;
      const gutterCapped = `${'x'.repeat(500)}\n[output truncated at 500000 chars after adding line numbers. Use a smaller line range or grep to narrow down.]`;

      for (const reReadContent of [
        cutMultiLine,
        cutSingleLine,
        archived,
        archiveFailed,
        gutterCapped,
      ]) {
        const messages = [
          sandboxRead('/big.ts', 'y'.repeat(3000), { endLine: 900, startLine: 800 }),
          sandboxRead('/big.ts', reReadContent),
          ...recencyPadding(3),
        ];

        const result = await createProcessor().process(createContext(messages));

        expect(result.messages[0].content).toBe('y'.repeat(3000));
        expect(result.metadata.staleToolResultTrim?.trimmedMessages ?? 0).toBe(0);
      }
    });

    it('still lets a normal bounded readFile with a continuation notice cover an earlier sub-range', async () => {
      const bounded = formatFileContent({
        content: Array.from({ length: 200 }, (_, i) => `line ${i + 1} ${'z'.repeat(20)}`).join(
          '\n',
        ),
        continueFrom: (line) =>
          `call readFile again with path="/a.ts", startLine=${line} and endLine=${line + 199}`,
        firstLineNumber: 1,
        lineRange: [0, 200],
        totalLines: 500,
      });

      const messages = [
        sandboxRead('/a.ts', 'y'.repeat(3000), { endLine: 100, startLine: 1 }),
        sandboxRead('/a.ts', bounded, { endLine: 200, startLine: 1 }),
        ...recencyPadding(3),
      ];

      const result = await createProcessor().process(createContext(messages));

      expect(result.messages[0].content).toContain('(lines 1-100)');
      expect(result.messages[0].content).toContain('the same range was read again later');
    });
  });

  describe('old command output', () => {
    const output = `${'H'.repeat(600)}${'M'.repeat(5000)}${'T'.repeat(600)}`;

    it.each([
      [SANDBOX, 'runCommand'],
      [SANDBOX, 'getCommandOutput'],
      [SANDBOX, 'executeCode'],
      [SKILLS, 'runCommand'],
      [SKILLS, 'execScript'],
    ])('keeps the head and tail of an old %s/%s result', async (identifier, apiName) => {
      const messages = [toolMessage(identifier, apiName, output), ...recencyPadding(3)];

      const result = await createProcessor().process(createContext(messages));
      const content = result.messages[0].content as string;

      expect(content.startsWith('H'.repeat(500))).toBe(true);
      expect(content.endsWith('T'.repeat(500))).toBe(true);
      expect(content).toContain(
        `[... trimmed ${output.length - 1000} chars of old command output ...]`,
      );
      expect(result.metadata.staleToolResultTrim?.byRule).toEqual({ oldCommandOutput: 1 });
    });

    it('never trims a failed sandbox command result', async () => {
      const messages = [
        toolMessage(SANDBOX, 'runCommand', output, {}, { pluginError: { message: 'exit 1' } }),
        ...recencyPadding(3),
      ];

      const result = await createProcessor().process(createContext(messages));

      expect(result.messages[0].content).toBe(output);
    });

    it('leaves other skills APIs untouched', async () => {
      const messages = [toolMessage(SKILLS, 'readReference', output), ...recencyPadding(3)];

      const result = await createProcessor().process(createContext(messages));

      expect(result.messages[0].content).toBe(output);
    });

    it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
      'does not throw or trim for Object.prototype identifier %s',
      async (identifier) => {
        const messages = [toolMessage(identifier, 'runCommand', output), ...recencyPadding(3)];

        const result = await createProcessor().process(createContext(messages));

        expect(result.messages[0].content).toBe(output);
        expect(result.metadata.staleToolResultTrim?.trimmedMessages ?? 0).toBe(0);
      },
    );
  });

  it('trims a realistic cloud sandbox coding history at a cold boundary', async () => {
    const messages = [
      { content: 'fix the bug', id: 'u1', role: 'user' },
      sandboxRead('/workspace/src/app.ts', 'a'.repeat(55_000)),
      write(SANDBOX, '/workspace/src/app.ts', 'editFile'),
      toolMessage(SANDBOX, 'runCommand', 'b'.repeat(33_000), { command: 'pnpm test' }),
      toolMessage(SKILLS, 'runCommand', 'c'.repeat(27_000), { command: 'pnpm build' }),
      ...recencyPadding(20),
      { content: 'continue', id: 'u2', role: 'user' },
    ];

    const result = await new StaleToolResultTrimProcessor().process(createContext(messages));

    expect(result.metadata.staleToolResultTrim).toMatchObject({
      byRule: { oldCommandOutput: 2, readSupersededByWrite: 1 },
      trimmedMessages: 3,
    });
    expect(result.metadata.staleToolResultTrim!.savedChars).toBeGreaterThan(110_000);
  });
});
