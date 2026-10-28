import { parse } from '@lobechat/conversation-flow';
import { type UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { flattenExportMessages } from './flattenExportMessages';
import { generateMarkdown } from './ShareText/template';

const tool = {
  apiName: 'getWeather',
  arguments: '{"city":"Beijing"}',
  id: 'call-1',
  identifier: 'weather',
  type: 'default',
};

// The rows as stored: one user turn answered by a two-step agent run.
const rawMessages = [
  {
    content: 'How is the weather in Beijing?',
    createdAt: 1,
    id: 'user-1',
    parentId: null,
    role: 'user',
    updatedAt: 1,
  },
  {
    content: 'Let me check.',
    createdAt: 2,
    id: 'assistant-1',
    parentId: 'user-1',
    role: 'assistant',
    tools: [tool],
    updatedAt: 2,
  },
  {
    content: '{"temperature":12}',
    createdAt: 3,
    id: 'tool-1',
    parentId: 'assistant-1',
    plugin: tool,
    role: 'tool',
    tool_call_id: 'call-1',
    updatedAt: 3,
  },
  {
    content: 'It is 12°C and clear in Beijing.',
    createdAt: 4,
    id: 'assistant-2',
    parentId: 'tool-1',
    role: 'assistant',
    updatedAt: 4,
  },
] as UIChatMessage[];

const displayMessages = parse(rawMessages as any).flatList as UIChatMessage[];

const markdown = (messages: UIChatMessage[], includeTool = true) =>
  generateMarkdown({
    includeTool,
    includeUser: true,
    messages,
    systemRole: '',
    title: 'Topic',
    withRole: true,
    withSystemRole: false,
  });

describe('flattenExportMessages', () => {
  it('folds the agent run into one group with no content of its own', () => {
    // Guards the premise: if the display list stops folding, this helper can go.
    expect(displayMessages.map((m) => m.role)).toEqual(['user', 'assistantGroup']);
    expect(displayMessages[1].content).toBe('');
  });

  it('exports the assistant replies of a folded turn, not only the user message', () => {
    const result = markdown(flattenExportMessages(displayMessages, rawMessages));

    expect(result).toContain('How is the weather in Beijing?');
    expect(result).toContain('##### Assistant:');
    expect(result).toContain('Let me check.');
    expect(result).toContain('It is 12°C and clear in Beijing.');
    expect(result).toContain('##### Tools Calling:');
    expect(result).toContain('{"temperature":12}');
    expect(result.indexOf('Let me check.')).toBeLessThan(result.indexOf('{"temperature":12}'));
    expect(result.indexOf('{"temperature":12}')).toBeLessThan(
      result.indexOf('It is 12°C and clear in Beijing.'),
    );
  });

  it('leaves tool rows out when skill messages are off', () => {
    const result = markdown(flattenExportMessages(displayMessages, rawMessages), false);

    expect(result).toContain('It is 12°C and clear in Beijing.');
    expect(result).not.toContain('{"temperature":12}');
  });

  it('does not repeat the tool result inside the assistant tool call', () => {
    const [, assistant] = flattenExportMessages(displayMessages, rawMessages);

    expect(assistant.role).toBe('assistant');
    expect(assistant.tools?.[0]).not.toHaveProperty('result');
  });

  it('keeps the raw tool row so a projected body can still be restored', () => {
    const projected = rawMessages.map((m) =>
      m.id === 'tool-1' ? { ...m, content: '', payloadOmitted: 'render' as const } : m,
    );
    const flat = flattenExportMessages(
      parse(projected as any).flatList as UIChatMessage[],
      projected,
    );

    expect(flat.find((m) => m.id === 'tool-1')).toMatchObject({
      payloadOmitted: 'render',
      role: 'tool',
    });
  });

  it('builds the tool row from the folded result when the raw row is not loaded', () => {
    const flat = flattenExportMessages(displayMessages);

    expect(flat.find((m) => m.id === 'tool-1')).toMatchObject({
      content: '{"temperature":12}',
      role: 'tool',
      tool_call_id: 'call-1',
    });
  });

  it('unfolds council members inside a supervisor turn', () => {
    const member = {
      children: [{ content: 'Member answer', id: 'member-block' }],
      content: '',
      createdAt: 5,
      id: 'member-1',
      role: 'assistantGroup',
      updatedAt: 5,
    } as UIChatMessage;
    const supervisor = {
      children: [
        { content: 'Asking the council.', id: 'supervisor-block' },
        { content: '', council: [member], id: 'council-supervisor-block' },
      ],
      content: '',
      createdAt: 4,
      id: 'supervisor-1',
      role: 'supervisor',
      updatedAt: 4,
    } as UIChatMessage;

    const flat = flattenExportMessages([supervisor]);

    expect(flat.map((m) => [m.role, m.content])).toEqual([
      ['assistant', 'Asking the council.'],
      ['assistant', 'Member answer'],
    ]);
  });

  it('passes ungrouped messages through untouched', () => {
    const user = rawMessages[0];

    expect(flattenExportMessages([user])).toEqual([user]);
  });
});
