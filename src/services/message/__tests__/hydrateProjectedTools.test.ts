import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import {
  hydrateProjectedToolMessages,
  mergeStoredToolPayloads,
} from '../hydrateProjectedTools';

const msg = (over: Partial<UIChatMessage>): UIChatMessage =>
  ({ content: '', createdAt: 1_780_000_000_000, id: 'm', role: 'user', ...over }) as UIChatMessage;

const projectedTool = (over: Partial<UIChatMessage> = {}) =>
  msg({
    content: '',
    contentLength: 9736,
    id: 't1',
    payloadOmitted: 'render',
    pluginState: { exitCode: 0 },
    role: 'tool',
    tool_call_id: 'call_1',
    ...over,
  });

describe('hydrateProjectedToolMessages', () => {
  it('restores both halves — a projector reduces state as well as the body', () => {
    // An export calls itself lossless; restoring only the body would still ship
    // a command without its stdout or a document without its text.
    const fetchStored = vi.fn().mockResolvedValue({
      t1: { content: 'real output', pluginState: { exitCode: 0, stdout: 'real output' } },
    });

    return hydrateProjectedToolMessages([projectedTool()], fetchStored).then(({ messages }) => {
      expect(messages[0].content).toBe('real output');
      expect(messages[0].pluginState).toEqual({ exitCode: 0, stdout: 'real output' });
    });
  });

  it('asks for every omitted row in one request', async () => {
    const fetchStored = vi.fn().mockResolvedValue({});

    await hydrateProjectedToolMessages(
      [projectedTool(), projectedTool({ id: 't2' }), projectedTool({ id: 't3' })],
      fetchStored,
    );

    expect(fetchStored).toHaveBeenCalledTimes(1);
    expect(fetchStored).toHaveBeenCalledWith(['t1', 't2', 't3']);
  });

  it('reports a row the server did not return instead of passing it off as restored', async () => {
    const fetchStored = vi.fn().mockResolvedValue({ t1: { content: 'ok' } });

    const { messages, missing } = await hydrateProjectedToolMessages(
      [projectedTool(), projectedTool({ id: 't2' })],
      fetchStored,
    );

    expect(missing).toEqual(['t2']);
    expect(messages[1].content).toBe('');
  });

  it('reports every row when the request itself fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStored = vi.fn().mockRejectedValue(new Error('offline'));

    const { messages, missing } = await hydrateProjectedToolMessages(
      [projectedTool()],
      fetchStored,
    );

    expect(missing).toEqual(['t1']);
    expect(messages[0].content).toBe('');
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('fetches nothing when no tool body was projected away', async () => {
    const fetchStored = vi.fn();
    const messages = [msg({ content: 'plain', id: 't2', role: 'tool', tool_call_id: 'c2' })];

    const result = await hydrateProjectedToolMessages(messages, fetchStored);

    expect(result).toEqual({ messages, missing: [] });
    expect(fetchStored).not.toHaveBeenCalled();
  });

  it('leaves every other message untouched', async () => {
    const user = msg({ content: 'hi', id: 'u1', role: 'user' });
    const fetchStored = vi.fn().mockResolvedValue({ t1: { content: 'out' } });

    const { messages } = await hydrateProjectedToolMessages([user, projectedTool()], fetchStored);

    expect(messages[0]).toBe(user);
  });
});

describe('mergeStoredToolPayloads', () => {
  it('merges into the messages given NOW, not the ones the fetch saw', () => {
    // The export modal caches the payload map by row id; a turn arriving while
    // it is open must still make it into the file.
    const payloads = { t1: { content: 'restored' } };
    const later = [projectedTool(), msg({ content: 'a new turn', id: 'u2', role: 'user' })];

    const { messages, missing } = mergeStoredToolPayloads(later, payloads);

    expect(messages.map((m) => m.content)).toEqual(['restored', 'a new turn']);
    expect(missing).toEqual([]);
  });

  it('reports every projected row while the map is still absent', () => {
    const { missing } = mergeStoredToolPayloads([projectedTool()], undefined);

    expect(missing).toEqual(['t1']);
  });
});
