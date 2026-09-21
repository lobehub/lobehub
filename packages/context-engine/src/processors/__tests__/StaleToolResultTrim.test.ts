import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { StaleToolResultTrimProcessor } from '../StaleToolResultTrim';

const createContext = (messages: any[]): PipelineContext => ({
  initialState: { messages: [] },
  isAborted: false,
  messages,
  metadata: {},
});

const toolMessage = (
  identifier: string,
  apiName: string,
  content: string,
  overrides?: Record<string, unknown>,
) => ({
  content,
  id: `tool-${apiName}-${Math.random()}`,
  plugin: { apiName, identifier },
  role: 'tool',
  tool_call_id: `call-${apiName}`,
  ...overrides,
});

const readFileResult = (path: string, content: string, loc?: [number, number]) =>
  toolMessage('lobe-local-system', 'readFile', content, {
    plugin: {
      apiName: 'readFile',
      // Canonical wire shape: arguments arrive as the serialized JSON string
      // from the model's tool call, not a parsed object.
      arguments: JSON.stringify({ loc, path }),
      identifier: 'lobe-local-system',
    },
    pluginState: { loc, path },
  });

const writeFileResult = (path: string) =>
  toolMessage('lobe-local-system', 'writeFile', `Successfully wrote to ${path}`, {
    plugin: {
      apiName: 'writeFile',
      arguments: JSON.stringify({ path }),
      identifier: 'lobe-local-system',
    },
    pluginState: { path, success: true },
  });

// Tail padding that keeps the trim window away from the messages under test.
const recencyPadding = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    content: `recent ${i}`,
    id: `pad-${i}`,
    role: 'assistant',
    tool_call_id: undefined,
  }));

const createProcessor = () =>
  new StaleToolResultTrimProcessor({ keepRecentMessages: 3, minTotalToolChars: 0 });

describe('StaleToolResultTrimProcessor', () => {
  it('trims a readFile result superseded by a later write to the same path', async () => {
    const messages = [
      readFileResult('/a.ts', 'x'.repeat(5000), [0, 200]),
      writeFileResult('/a.ts'),
      ...recencyPadding(3),
    ];

    const result = await createProcessor().process(createContext(messages));

    expect(result.messages[0].content).toBe(
      '[readFile result trimmed: /a.ts — superseded by a later write to this file. Call readFile again if you need the current content.]',
    );
    expect(result.messages[0].tool_call_id).toBe(messages[0].tool_call_id);
    expect(result.messages[1].content).toBe(messages[1].content);
    expect(result.metadata.staleToolResultTrim).toMatchObject({
      byRule: { readSupersededByWrite: 1 },
      cacheWarm: false,
      savedChars: 5000 - (result.messages[0].content as string).length,
      trimmedMessages: 1,
    });
  });

  it('trims a readFile result whose range was fully re-read later', async () => {
    const messages = [
      readFileResult('/a.ts', 'y'.repeat(3000), [0, 100]),
      readFileResult('/a.ts', 'z'.repeat(6000), [0, 200]),
      ...recencyPadding(3),
    ];

    const result = await createProcessor().process(createContext(messages));

    expect(result.messages[0].content).toContain('the same range was read again later');
    expect(result.messages[1].content).toBe('z'.repeat(6000));
  });

  it('keeps complementary reads of the same file (partial overlap is not coverage)', async () => {
    const messages = [
      readFileResult('/a.ts', 'first chunk', [0, 200]),
      readFileResult('/a.ts', 'second chunk', [200, 400]),
      ...recencyPadding(3),
    ];

    const result = await createProcessor().process(createContext(messages));

    expect(result.messages[0].content).toBe('first chunk');
    expect(result.messages[1].content).toBe('second chunk');
    expect(result.metadata.staleToolResultTrim?.trimmedMessages ?? 0).toBe(0);
  });

  it('trims stale browser snapshots outside the recency window', async () => {
    const messages = [
      toolMessage('lobe-browser', 'snapshot', '- button "写作" [ref=e1]\n'.repeat(100)),
      toolMessage('lobe-browser', 'readPage', 'page text '.repeat(100)),
      ...recencyPadding(3),
    ];

    const result = await createProcessor().process(createContext(messages));

    expect(result.messages[0].content).toContain('stale page state');
    expect(result.messages[1].content).toContain('stale page state');
    expect(result.metadata.staleToolResultTrim?.byRule).toEqual({ staleBrowserPage: 2 });
  });

  it('keeps the head and tail of old command output', async () => {
    const longOutput = `HEAD-${'a'.repeat(2000)}-TAIL`;
    const messages = [
      toolMessage('lobe-local-system', 'runCommand', longOutput),
      ...recencyPadding(3),
    ];

    const result = await new StaleToolResultTrimProcessor({
      commandKeepChars: 100,
      keepRecentMessages: 3,
      minTotalToolChars: 0,
    }).process(createContext(messages));

    const content = result.messages[0].content as string;
    expect(content).toContain('HEAD-');
    expect(content).toContain('-TAIL');
    expect(content).toContain('trimmed');
    expect(content.length).toBeLessThan(longOutput.length);
  });

  it('trims old web-browsing results to a head excerpt', async () => {
    const longPage = `<crawlResults>${'p'.repeat(5000)}</crawlResults>`;
    const messages = [
      toolMessage('lobe-web-browsing', 'crawlSinglePage', longPage),
      ...recencyPadding(3),
    ];

    const result = await new StaleToolResultTrimProcessor({
      crawlKeepChars: 200,
      keepRecentMessages: 3,
      minTotalToolChars: 0,
    }).process(createContext(messages));

    const content = result.messages[0].content as string;
    expect(content.startsWith('<crawlResults>')).toBe(true);
    expect(content).toContain('trimmed');
    expect(content.length).toBeLessThan(400);
  });

  it('never trims error results', async () => {
    const messages = [
      toolMessage('lobe-browser', 'snapshot', 'e'.repeat(5000), {
        pluginError: { message: 'Script failed to execute' },
      }),
      ...recencyPadding(3),
    ];

    const result = await createProcessor().process(createContext(messages));

    expect(result.messages[0].content).toBe('e'.repeat(5000));
  });

  it('never touches the recency window', async () => {
    const messages = [
      ...recencyPadding(3),
      toolMessage('lobe-browser', 'snapshot', 'recent snapshot '.repeat(100)),
    ];

    const result = await createProcessor().process(createContext(messages));

    expect(result.messages[3].content).toBe('recent snapshot '.repeat(100));
  });

  it('skips small histories entirely', async () => {
    const processor = new StaleToolResultTrimProcessor({ minTotalToolChars: 1_000_000 });
    const messages = [
      readFileResult('/a.ts', 'short', [0, 10]),
      writeFileResult('/a.ts'),
      ...recencyPadding(3),
    ];

    const result = await processor.process(createContext(messages));

    expect(result.messages[0].content).toBe('short');
    expect(result.metadata.staleToolResultTrim).toBeUndefined();
  });

  it('is idempotent — trimming an already-trimmed history is byte-stable', async () => {
    const processor = createProcessor();
    const messages = [
      readFileResult('/a.ts', 'x'.repeat(5000), [0, 200]),
      writeFileResult('/a.ts'),
      toolMessage('lobe-browser', 'snapshot', 'snap '.repeat(500)),
      ...recencyPadding(3),
    ];

    const first = await processor.process(createContext(messages));
    const second = await processor.process(createContext(first.messages));

    expect(second.messages).toEqual(first.messages);
    expect(second.metadata.staleToolResultTrim?.trimmedMessages ?? 0).toBe(0);
  });

  it('does nothing when disabled', async () => {
    const processor = new StaleToolResultTrimProcessor({ enabled: false, minTotalToolChars: 0 });
    const messages = [readFileResult('/a.ts', 'x'.repeat(5000)), writeFileResult('/a.ts')];

    const result = await processor.process(createContext(messages));

    expect(result.messages[0].content).toBe('x'.repeat(5000));
  });

  // Every LLM step of a running operation re-runs the pipeline; the trim set
  // must stay frozen for the whole turn or the prefix flips mid-operation.
  it('never trims messages from the in-flight turn, and an in-flight write does not retroactively trim', async () => {
    const processor = new StaleToolResultTrimProcessor({
      keepRecentMessages: 1,
      minTotalToolChars: 0,
    });
    const messages = [
      readFileResult('/a.ts', 'x'.repeat(5000), [0, 200]),
      writeFileResult('/a.ts'),
      { content: '继续', id: 'user-1', role: 'user' },
      readFileResult('/b.ts', 'y'.repeat(5000), [0, 200]),
      writeFileResult('/b.ts'), // in-flight write — must NOT trim the read above mid-turn
      ...recencyPadding(3),
    ];

    const result = await processor.process(createContext(messages));

    // Closed history before the boundary: trimmed
    expect(result.messages[0].content).toContain('superseded by a later write');
    // In-flight: untouched even though /b.ts was likewise overwritten
    expect(result.messages[3].content).toBe('y'.repeat(5000));
    expect(result.metadata.staleToolResultTrim?.trimmedMessages).toBe(1);
  });

  // Regression (Codex P1): the recency cutoff must be derived from the turn
  // boundary, not the growing message count — otherwise results that started
  // inside the protected tail cross the cutoff as the op appends messages.
  it('freezes the recency window at the turn boundary for the whole operation', async () => {
    const processor = new StaleToolResultTrimProcessor({
      keepRecentMessages: 3,
      minTotalToolChars: 0,
    });
    const staleSnapshot = toolMessage('lobe-browser', 'snapshot', 'snap '.repeat(500));
    const messages = [
      { content: 'older turn', id: 'm0', role: 'assistant' },
      staleSnapshot, // index 1: inside the 3-message protected tail at turn start
      { content: 'tail', id: 'm2', role: 'assistant' },
      { content: 'start working', id: 'user-1', role: 'user' },
      // 50 in-flight messages appended as the operation progresses
      ...recencyPadding(50),
    ];

    const result = await processor.process(createContext(messages));

    expect(result.messages[1].content).toBe(staleSnapshot.content);
    expect(result.metadata.staleToolResultTrim?.trimmedMessages ?? 0).toBe(0);
  });

  it('parses serialized string arguments when pluginState is absent', async () => {
    const legacyRead = toolMessage('lobe-local-system', 'readFile', 'x'.repeat(5000), {
      plugin: {
        apiName: 'readFile',
        arguments: JSON.stringify({ path: '/legacy.ts' }),
        identifier: 'lobe-local-system',
      },
    });
    const legacyWrite = toolMessage(
      'lobe-local-system',
      'writeFile',
      'Successfully wrote to /legacy.ts',
      {
        plugin: {
          apiName: 'writeFile',
          arguments: JSON.stringify({ path: '/legacy.ts' }),
          identifier: 'lobe-local-system',
        },
      },
    );

    const result = await createProcessor().process(
      createContext([legacyRead, legacyWrite, ...recencyPadding(3)]),
    );

    expect(result.messages[0].content).toContain('superseded by a later write');
  });

  describe('cache-warmth gate', () => {
    const T0 = Date.parse('2026-09-20T08:00:00Z');
    const MIN = 60_000;

    // Filler between the write and the trigger keeps the write result outside
    // the recency tail (keepRecentMessages=3 in createProcessor), so the stale
    // read is a trim candidate; the last two entries fix the turn-boundary
    // timestamps the warmth gate reads.
    const turnMessages = (staleChars: number, gapMs: number) => [
      readFileResult('/a.ts', 'x'.repeat(staleChars), [0, 200]),
      writeFileResult('/a.ts'),
      { content: 'filler 1', id: 'f1', role: 'assistant' },
      { content: 'filler 2', id: 'f2', role: 'assistant' },
      { content: 'filler 3', id: 'f3', role: 'assistant' },
      {
        content: 'previous turn done',
        createdAt: new Date(T0).toISOString(),
        id: 'prev',
        role: 'assistant',
      },
      {
        content: 'next task',
        createdAt: new Date(T0 + gapMs).toISOString(),
        id: 'trigger',
        role: 'user',
      },
      ...recencyPadding(3),
    ];

    it('trims when the gap exceeds the cache TTL (cold cache — trim is free)', async () => {
      const result = await createProcessor().process(
        createContext(turnMessages(5000, 10 * MIN)), // 10 min gap > 5 min TTL
      );

      expect(result.messages[0].content).toContain('superseded by a later write');
      expect(result.metadata.staleToolResultTrim).toMatchObject({
        cacheWarm: false,
        gapMs: 10 * MIN,
        trimmedMessages: 1,
      });
    });

    it('skips the trim on a warm follow-up when savings are small relative to the payload', async () => {
      // Large live payload (untrimmed) + small stale read: the rewrite of ~500k
      // chars at write price dwarfs 20 estimated steps of 5k-char savings.
      const result = await createProcessor().process(
        createContext([
          { content: 'z'.repeat(500_000), id: 'big-live-doc', role: 'assistant' },
          ...turnMessages(5000, 1 * MIN),
        ]),
      );

      expect(result.messages[1].content).toBe('x'.repeat(5000));
      expect(result.metadata.staleToolResultTrim).toMatchObject({
        cacheWarm: true,
        gapMs: 60_000,
        savedChars: 0,
        skippedReason: 'warm-cache',
        trimmedMessages: 0,
      });
      // the gate's economic inputs are recorded for observability
      expect(result.metadata.staleToolResultTrim?.potentialSavedChars).toBeGreaterThan(4000);
      expect(result.metadata.staleToolResultTrim?.gainEstimate).toBeGreaterThan(0);
      expect(result.metadata.staleToolResultTrim?.rewriteCostEstimate).toBeGreaterThan(0);
    });

    it('still trims on a warm follow-up when savings clear the warm thresholds', async () => {
      const result = await createProcessor().process(
        createContext(turnMessages(400_000, 1 * MIN)), // ~400k chars saved, >99% of payload
      );

      expect(result.messages[0].content).toContain('superseded by a later write');
      expect(result.metadata.staleToolResultTrim?.trimmedMessages).toBe(1);
    });
  });
});
