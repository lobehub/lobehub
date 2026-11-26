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
