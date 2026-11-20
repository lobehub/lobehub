import { describe, expect, it } from 'vitest';

import { ExecAgentSchema, foldLegacyUserMessageFields } from './execSchemas';

const quote = { content: 'Quoted reply', id: 'selection-1', source: 'text' as const };
const page = { content: 'Selected paragraph', id: 'page-selection-1', pageId: 'page-1' };

describe('foldLegacyUserMessageFields', () => {
  it('folds the deprecated top-level selections into userMessage.metadata', () => {
    const input = ExecAgentSchema.parse({
      agentId: 'agent-1',
      contextSelections: [quote],
      pageSelections: [page],
      prompt: 'Explain this',
    });

    const folded = foldLegacyUserMessageFields(input);

    expect(folded).not.toHaveProperty('contextSelections');
    expect(folded).not.toHaveProperty('pageSelections');
    expect(folded.userMessage).toEqual({
      metadata: { contextSelections: [quote], pageSelections: [page] },
    });
  });

  it('lets userMessage win when a client sends both shapes', () => {
    const newer = { ...quote, content: 'Newer quote' };
    const input = ExecAgentSchema.parse({
      agentId: 'agent-1',
      contextSelections: [quote],
      prompt: 'Explain this',
      userMessage: { editorData: { root: {} }, metadata: { contextSelections: [newer] } },
    });

    expect(foldLegacyUserMessageFields(input).userMessage).toEqual({
      editorData: { root: {} },
      metadata: { contextSelections: [newer] },
    });
  });

  it('leaves a request without legacy fields untouched', () => {
    const input = ExecAgentSchema.parse({ agentId: 'agent-1', prompt: 'Hello' });

    expect(foldLegacyUserMessageFields(input)).toEqual(input);
  });

  it('strips server-owned fields a client puts in userMessage.metadata', () => {
    const input = ExecAgentSchema.parse({
      agentId: 'agent-1',
      prompt: 'Hello',
      userMessage: {
        metadata: { agentSender: { id: 'agt_x' }, contextSelections: [quote], trigger: 'bot' },
      },
    });

    expect(input.userMessage).toEqual({ metadata: { contextSelections: [quote] } });
  });
});
