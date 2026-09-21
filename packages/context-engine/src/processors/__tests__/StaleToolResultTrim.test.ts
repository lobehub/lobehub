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
  ...overrides,
});

const readFileResult = (path: string, content: string, loc?: [number, number]) =>
  toolMessage('lobe-local-system', 'readFile', content, {
    plugin: { apiName: 'readFile', arguments: { loc, path }, identifier: 'lobe-local-system' },
  });

const writeFileResult = (path: string) =>
  toolMessage('lobe-local-system', 'writeFile', `Successfully wrote to ${path}`, {
    plugin: { apiName: 'writeFile', arguments: { path }, identifier: 'lobe-local-system' },
  });

// Tail padding that keeps the trim window away from the messages under test.
const recencyPadding = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    content: `recent ${i}`,
    id: `pad-${i}`,
    role: 'assistant',
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
    expect(result.metadata.staleToolResultTrim).toEqual({
      byRule: { readSupersededByWrite: 1 },
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
    expect(result.metadata.staleToolResultTrim?.trimmedMessages).toBe(0);
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
    expect(second.metadata.staleToolResultTrim?.trimmedMessages).toBe(0);
  });

  it('does nothing when disabled', async () => {
    const processor = new StaleToolResultTrimProcessor({ enabled: false, minTotalToolChars: 0 });
    const messages = [readFileResult('/a.ts', 'x'.repeat(5000)), writeFileResult('/a.ts')];

    const result = await processor.process(createContext(messages));

    expect(result.messages[0].content).toBe('x'.repeat(5000));
  });

  // Every LLM step of a running operation re-runs the pipeline; trimming a
  // message from the in-flight turn would rewrite the prefix mid-operation
  // and cold the prompt cache for every remaining step. The trim must stop at
  // the last user message (the operation boundary), where the cache is cold
  // anyway.
  it('never trims messages from the in-flight turn (after the last user message)', async () => {
    const messages = [
      readFileResult('/a.ts', 'x'.repeat(5000), [0, 200]),
      writeFileResult('/a.ts'),
      { content: '继续', id: 'user-1', role: 'user' },
      readFileResult('/b.ts', 'y'.repeat(5000), [0, 200]),
      writeFileResult('/b.ts'),
      ...recencyPadding(3),
    ];

    const result = await createProcessor().process(createContext(messages));

    // Before the boundary: trimmed
    expect(result.messages[0].content).toContain('superseded by a later write');
    // After the boundary: untouched even though /b.ts was likewise overwritten
    expect(result.messages[3].content).toBe('y'.repeat(5000));
    expect(result.metadata.staleToolResultTrim?.trimmedMessages).toBe(1);
  });
});
