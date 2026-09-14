import type { AwarenessCursorLabelInput } from '@lobehub/editor';
import { describe, expect, it, vi } from 'vitest';

import { createPageAwarenessLabelFormatter } from './collaborationAwarenessLabel';

const input = (overrides: Partial<AwarenessCursorLabelInput>): AwarenessCursorLabelInput => ({
  name: 'AI Agent',
  state: {} as AwarenessCursorLabelInput['state'],
  ...overrides,
});

describe('Page collaboration awareness labels', () => {
  it('uses the Page locale for AI thinking and writing labels with loading state', () => {
    const translate = vi.fn((key: string) => {
      const labels: Record<string, string> = {
        'collaboration.aiAgent': 'AI Agent',
        'collaboration.aiAgentThinking': 'AI Agent（思考中…）',
        'collaboration.aiAgentWriting': 'AI Agent（正在输入…）',
      };
      return labels[key] ?? key;
    });
    const formatter = createPageAwarenessLabelFormatter(translate);

    expect(formatter(input({ role: 'agent', status: 'thinking' }))).toEqual({
      label: 'AI Agent（思考中…）',
      loading: true,
    });
    expect(formatter(input({ role: 'agent', status: 'writing' }))).toEqual({
      label: 'AI Agent（正在输入…）',
      loading: true,
    });
    expect(translate).toHaveBeenCalledWith('collaboration.aiAgentThinking');
    expect(translate).toHaveBeenCalledWith('collaboration.aiAgentWriting');
  });

  it('keeps ordinary collaborator names unchanged', () => {
    const translate = vi.fn((key: string) => key);
    const formatter = createPageAwarenessLabelFormatter(translate);

    expect(formatter(input({ name: 'Alice', role: 'browser', status: 'writing' }))).toEqual({
      label: 'Alice',
      loading: false,
    });
    expect(translate).not.toHaveBeenCalled();
  });
});
