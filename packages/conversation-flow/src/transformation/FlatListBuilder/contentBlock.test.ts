import { describe, expect, it } from 'vitest';

import { parse } from '../../parse';
import type { Message } from '../../types';
import { MessageTransformer } from '../MessageTransformer';
import { resolveBlockMetadata, toAssistantContentBlock } from './contentBlock';

const toolStep = (
  id: string,
  parentId: string,
  toolId: string,
  source: Partial<Pick<Message, 'model' | 'provider'>>,
): Message[] => [
  {
    content: '',
    createdAt: Number(id.replaceAll(/\D/g, '')) * 10,
    id,
    parentId,
    reasoning: { content: `reasoning of ${id}`, signature: `sig-${id}` },
    role: 'assistant',
    tools: [
      { apiName: 'run', arguments: '{}', id: toolId, identifier: 'sandbox', type: 'default' },
    ],
    updatedAt: 0,
    ...source,
  } as Message,
  {
    content: 'ok',
    createdAt: Number(id.replaceAll(/\D/g, '')) * 10 + 1,
    id: toolId,
    parentId: id,
    role: 'tool',
    tool_call_id: toolId,
    updatedAt: 0,
  } as Message,
];

describe('toAssistantContentBlock', () => {
  it("keeps the row's own model and provider, and omits them when the row has none", () => {
    const transformer = new MessageTransformer();
    const withSource = {
      content: 'hi',
      id: 'a-1',
      model: 'claude-opus-5-5',
      provider: 'anthropic',
      role: 'assistant',
    } as Message;
    const legacy = { content: 'hi', id: 'a-2', role: 'assistant' } as Message;

    expect(
      toAssistantContentBlock(withSource, resolveBlockMetadata(withSource, transformer)),
    ).toMatchObject({ model: 'claude-opus-5-5', provider: 'anthropic' });

    const legacyBlock = toAssistantContentBlock(legacy, resolveBlockMetadata(legacy, transformer));
    expect(legacyBlock).not.toHaveProperty('model');
    expect(legacyBlock).not.toHaveProperty('provider');
  });

  it('gives every child of a group the source of its own step across a model switch', () => {
    const { flatList } = parse([
      { content: 'go', createdAt: 1, id: 'u1', role: 'user', updatedAt: 0 } as Message,
      ...toolStep('a2', 'u1', 't2', { model: 'claude-opus-5-5', provider: 'anthropic' }),
      ...toolStep('a3', 't2', 't3', { model: 'deepseek-v4-pro', provider: 'deepseek' }),
    ]);

    const group = flatList.find((message) => message.role === 'assistantGroup');
    expect(group?.model).toBe('claude-opus-5-5');
    expect(group?.children?.map(({ id, model, provider }) => ({ id, model, provider }))).toEqual([
      { id: 'a2', model: 'claude-opus-5-5', provider: 'anthropic' },
      { id: 'a3', model: 'deepseek-v4-pro', provider: 'deepseek' },
    ]);
  });
});
