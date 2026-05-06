import { describe, expect, it } from 'vitest';

import { defineCase, errorStep, llmStep, toolStep } from './defineCase';

describe('defineCase', () => {
  it('wraps llmStep into stream_start → chunks → stream_end', () => {
    const c = defineCase({
      id: 'simple',
      name: 'Simple LLM',
      steps: [llmStep({ text: 'Hello world', durationMs: 100 })],
    });
    expect(c.id).toBe('simple');
    expect(c.source.type).toBe('fixture');
    const events = c.source.type === 'fixture' ? c.source.events : [];
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('agent_runtime_init');
    expect(types).toContain('stream_start');
    expect(types).toContain('stream_end');
    expect(types.at(-1)).toBe('agent_runtime_end');
  });

  it('wraps toolStep into tool_start → tool_end', () => {
    const c = defineCase({
      id: 'tool-only',
      name: 'Tool only',
      steps: [
        toolStep({
          identifier: 'lobe-todo-write',
          apiName: 'addTodo',
          arguments: '{}',
          result: { success: true },
          durationMs: 100,
        }),
      ],
    });
    const events = c.source.type === 'fixture' ? c.source.events : [];
    const toolTypes = events
      .map((e) => e.type)
      .filter((t) => t === 'tool_start' || t === 'tool_end');
    expect(toolTypes).toEqual(['tool_start', 'tool_end']);
  });

  it('counts toolCount and stepCount in meta', () => {
    const c = defineCase({
      id: 'meta',
      name: 'meta',
      steps: [
        llmStep({ text: 'a', durationMs: 100 }),
        toolStep({ identifier: 'x', apiName: 'y', arguments: '{}', result: {}, durationMs: 100 }),
        toolStep({ identifier: 'x', apiName: 'y', arguments: '{}', result: {}, durationMs: 100 }),
      ],
    });
    expect(c.meta?.stepCount).toBe(3);
    expect(c.meta?.toolCount).toBe(2);
  });

  it('errorStep emits error event', () => {
    const c = defineCase({
      id: 'err',
      name: 'err',
      steps: [errorStep({ message: 'boom' })],
    });
    const events = c.source.type === 'fixture' ? c.source.events : [];
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });
});
