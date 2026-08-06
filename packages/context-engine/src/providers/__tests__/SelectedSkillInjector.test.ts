import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { parseSelectedSkillTags, SelectedSkillInjector } from '../SelectedSkillInjector';

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

  it('should inject skill content inline when available', async () => {
    const provider = new SelectedSkillInjector({
      selectedSkills: [
        {
          content: 'Use grep to search the codebase.\n\n## Usage\ngrep pattern file',
          identifier: 'grep',
          name: 'Grep',
        },
        { identifier: 'translate', name: 'Translate' },
      ],
    });

    const context = createContext([{ content: 'Search for foo', id: 'user-1', role: 'user' }]);

    const result = await provider.process(context);
    const content = result.messages[0].content as string;

    // Skill with content: open/close tag with content inside
    expect(content).toContain('<skill identifier="grep" name="Grep">');
    expect(content).toContain('Use grep to search the codebase.');
    expect(content).toContain('</skill>');
    // Skill without content: self-closing tag
    expect(content).toContain('<skill identifier="translate" name="Translate" />');
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

describe('parseSelectedSkillTags', () => {
  it('parses content-bearing skill tags', () => {
    const content =
      '<selected_skills>\n' +
      '  <skill identifier="marketing-adapter" name="Multi-Size Marketing Adapter">\n' +
      '  SKILL.md content\n' +
      '  </skill>\n' +
      '</selected_skills>';

    expect(parseSelectedSkillTags(content)).toEqual([
      { identifier: 'marketing-adapter', name: 'Multi-Size Marketing Adapter' },
    ]);
  });

  it('parses self-closing skill tags', () => {
    const content =
      '<selected_skills>\n  <skill identifier="pdf-tools" name="PDF Tools" />\n</selected_skills>';

    expect(parseSelectedSkillTags(content)).toEqual([
      { identifier: 'pdf-tools', name: 'PDF Tools' },
    ]);
  });

  it('parses multiple skills and tolerates attribute order', () => {
    const content =
      '<selected_skills>\n' +
      '  <skill name="Grep" identifier="grep" />\n' +
      '  <skill identifier="translate" name="Translate" />\n' +
      '</selected_skills>';

    expect(parseSelectedSkillTags(content)).toEqual([
      { identifier: 'grep', name: 'Grep' },
      { identifier: 'translate', name: 'Translate' },
    ]);
  });

  it('skips tags without an identifier', () => {
    const content =
      '<selected_skills>\n  <skill name="No Identifier" />\n  <skill identifier="ok" />\n</selected_skills>';

    expect(parseSelectedSkillTags(content)).toEqual([{ identifier: 'ok' }]);
  });

  it('returns an empty array for ordinary user messages (no selected_skills block)', () => {
    expect(parseSelectedSkillTags('hi, please help me with images')).toEqual([]);
    expect(parseSelectedSkillTags('')).toEqual([]);
  });

  it('round-trips with formatSelectedSkills', async () => {
    const { formatSelectedSkills } = await import('../SelectedSkillInjector');
    const skills = [
      { identifier: 'a', name: 'A' },
      { identifier: 'b', name: 'B' },
    ];
    const formatted = formatSelectedSkills(skills)!;

    expect(parseSelectedSkillTags(formatted).map((t) => t.identifier)).toEqual(['a', 'b']);
  });
});
