import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { SelectedSkillInjector } from '../SelectedSkillInjector';

const createContext = (messages: any[] = []): PipelineContext => ({
  initialState: {
    messages: [],
    model: 'gpt-4',
    provider: 'openai',
  },
  isAborted: false,
  messages,
  metadata: {
    maxTokens: 4096,
    model: 'gpt-4',
  },
});

describe('SelectedSkillInjector', () => {
  it('should append selected skills to the last user message', async () => {
    const provider = new SelectedSkillInjector({
      selectedSkills: [
        { identifier: 'user_memory', name: 'User Memory' },
        { identifier: 'instruction', name: 'Instruction' },
      ],
    });

    const context = createContext([
      { content: 'Earlier question', id: 'user-1', role: 'user' },
      { content: 'Assistant reply', id: 'assistant-1', role: 'assistant' },
      { content: 'Current request', id: 'user-2', role: 'user' },
    ]);

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(3);
    expect(result.messages[2].content).toContain('Current request');
    expect(result.messages[2].content).toContain('<selected_skill_context>');
    expect(result.messages[2].content).toContain('<selected_skills>');
    expect(result.messages[2].content).toContain(
      '<skill identifier="user_memory" name="User Memory" />',
    );
    expect(result.metadata.selectedSkillContext).toEqual({
      injected: true,
      skillsCount: 2,
    });
  });

  it('should reuse existing system context wrapper on the last user message', async () => {
    const provider = new SelectedSkillInjector({
      selectedSkills: [{ identifier: 'user_memory', name: 'User Memory' }],
    });

    const context = createContext([
      {
        content: `Current request

<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->
<current_page_context>
<page>draft</page>
</current_page_context>
<!-- END SYSTEM CONTEXT -->`,
        id: 'user-1',
        role: 'user',
      },
    ]);

    const result = await provider.process(context);
    const content = result.messages[0].content as string;

    expect(content.match(/<!-- SYSTEM CONTEXT \(NOT PART OF USER QUERY\) -->/g)).toHaveLength(1);
    expect(content).toContain('<current_page_context>');
    expect(content).toContain('<selected_skill_context>');
  });
});
