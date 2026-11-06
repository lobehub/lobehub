import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mcpAppContext } from './context';
import { initialState, useMcpAppStore } from './store';

const gate = vi.hoisted(() => ({ enabled: true }));
vi.mock('@/store/serverConfig', () => ({
  getServerConfigStoreState: () => ({}),
  serverConfigSelectors: { enableMcpApps: () => gate.enabled },
}));
beforeEach(() => {
  gate.enabled = true;
  useMcpAppStore.setState({
    ...initialState,
    views: {
      a: { identifier: 'notes', mode: 'inline', scope: 'topic-a', title: 'Notes' },
      b: { identifier: 'notes', mode: 'inline', scope: 'topic-b', title: 'Notes' },
    },
  });
});
const update = (id: string, text: string) =>
  mcpAppContext.update(id, { content: [{ type: 'text', text }] });
describe('MCP App context snapshots', () => {
  it('takes only the latest update, scoped to the sending conversation, and deduplicates unchanged content', () => {
    update('a', 'old');
    update('a', 'latest');
    update('b', 'other topic');
    expect(mcpAppContext.take('topic-a').selections).toEqual([
      { content: 'latest', id: 'a', identifier: 'notes', source: 'mcpApp', title: 'Notes' },
    ]);
    expect(mcpAppContext.take('topic-a').selections).toEqual([]);
    update('a', 'latest');
    expect(mcpAppContext.take('topic-a').selections).toEqual([]);
    expect(mcpAppContext.take('topic-b').selections[0].content).toBe('other topic');
    update('a', 'changed');
    expect(mcpAppContext.take('topic-a').selections[0].content).toBe('changed');
  });
  it('restores a failed send without overwriting a newer app update', () => {
    update('a', 'first');
    const transaction = mcpAppContext.take('topic-a');
    update('a', 'second');
    transaction.restore();
    expect(mcpAppContext.take('topic-a').selections[0].content).toBe('second');
  });
  it('lets the user remove a chip and clears destroyed views', () => {
    update('a', 'first');
    mcpAppContext.remove('a');
    expect(mcpAppContext.take('topic-a').selections).toEqual([]);
    update('a', 'second');
    mcpAppContext.clear('a');
    expect(mcpAppContext.take('topic-a').selections).toEqual([]);
  });
  it('replaces structured content too and supports empty updates', () => {
    update('a', 'old');
    mcpAppContext.update('a', { structuredContent: { selected: 2 } });
    expect(mcpAppContext.take('topic-a').selections[0].content).toBe('{"selected":2}');
    mcpAppContext.update('a', {});
    expect(useMcpAppStore.getState().contexts.a).toBeUndefined();
  });
  it('neither saves nor takes context while disabled', () => {
    update('a', 'pending');
    gate.enabled = false;
    update('a', 'ignored');
    expect(mcpAppContext.take('topic-a').selections).toEqual([]);
    expect(useMcpAppStore.getState().contexts.a.content).toBe('pending');
  });
});
