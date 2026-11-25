import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import type { SkillMeta } from '../SkillContextProvider';
import { SkillContextProvider } from '../SkillContextProvider';

const createContext = (messages: any[]): PipelineContext => ({
  initialState: { messages: [] } as any,
  isAborted: false,
  messages,
  metadata: { maxTokens: 4096, model: 'gpt-4' },
});

const createSkills = (): SkillMeta[] => [
  {
    description: 'Generate interactive UI components',
    identifier: 'artifacts',
    location: '/path/to/skills/artifacts/SKILL.md',
    name: 'Artifacts',
  },
  {
    description: 'Custom skill description',
    identifier: 'my-skill',
    name: 'My Skill',
  },
];

describe('SkillContextProvider', () => {
  it('should inject skill metadata when skills are provided', async () => {
    const skills = createSkills();
    const provider = new SkillContextProvider({ enabledSkills: skills });

    const messages = [{ content: 'Hello', id: 'u1', role: 'user' }];
    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage).toBeDefined();
    expect(systemMessage!.content).toMatchSnapshot();

    expect(result.metadata.skillContext).toEqual({
      injected: true,
      skillsCount: 2,
    });
  });

  it('should merge with existing system message', async () => {
    const skills = createSkills();
    const provider = new SkillContextProvider({ enabledSkills: skills });

    const existingSystemContent = 'You are a helpful assistant.';
    const messages = [
      { content: existingSystemContent, id: 's1', role: 'system' },
      { content: 'Hello', id: 'u1', role: 'user' },
    ];

    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage!.content).toMatchSnapshot();
  });

  it('should skip injection when no skills are provided', async () => {
    const provider = new SkillContextProvider({ enabledSkills: [] });

    const messages = [{ content: 'Hello', id: 'u1', role: 'user' }];
    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage).toBeUndefined();
    expect(result.metadata.skillContext).toBeUndefined();
  });

  it('should render XML with location attribute', async () => {
    const skills: SkillMeta[] = [
      {
        description: 'Extracts text from PDF files',
        identifier: 'pdf-processing',
        location: '/path/to/skills/pdf-processing/SKILL.md',
        name: 'PDF Processing',
      },
      {
        description: 'Analyzes datasets and generates charts',
        identifier: 'data-analysis',
        location: '/path/to/skills/data-analysis/SKILL.md',
        name: 'Data Analysis',
      },
    ];
    const provider = new SkillContextProvider({ enabledSkills: skills });

    const messages = [{ content: 'Hello', id: 'u1', role: 'user' }];
    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage!.content).toMatchSnapshot();
  });

  it('should render XML without location when not provided', async () => {
    const skills: SkillMeta[] = [
      {
        description: 'Custom skill description',
        identifier: 'my-skill',
        name: 'My Skill',
      },
    ];
    const provider = new SkillContextProvider({ enabledSkills: skills });

    const messages = [{ content: 'Hello', id: 'u1', role: 'user' }];
    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage!.content).toMatchSnapshot();
  });

  it('should directly inject content for activated skills', async () => {
    const skills: SkillMeta[] = [
      {
        activated: true,
        content: '<task_guides>\nUse `lh task` to manage tasks.\n</task_guides>',
        description: 'Task management via CLI',
        identifier: 'task',
        name: 'Task',
      },
      {
        description: 'Generate interactive UI components',
        identifier: 'artifacts',
        name: 'Artifacts',
      },
    ];
    const provider = new SkillContextProvider({ enabledSkills: skills });

    const messages = [{ content: 'Hello', id: 'u1', role: 'user' }];
    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage!.content).toMatchSnapshot();

    // Activated skill should NOT appear in <available_skills> list
    expect(systemMessage!.content).not.toContain('<skill name="Task">');

    expect(result.metadata.skillContext).toEqual({
      injected: true,
      skillsCount: 2,
    });
  });

  it('should handle all skills activated (no available_skills list)', async () => {
    const skills: SkillMeta[] = [
      {
        activated: true,
        content: 'Task skill content here',
        description: 'Task management',
        identifier: 'task',
        name: 'Task',
      },
    ];
    const provider = new SkillContextProvider({ enabledSkills: skills });

    const messages = [{ content: 'Hello', id: 'u1', role: 'user' }];
    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage!.content).toMatchSnapshot();
    expect(systemMessage!.content).not.toContain('<available_skills>');
  });

  it('should skip activated skill without content', async () => {
    const skills: SkillMeta[] = [
      {
        activated: true,
        // no content provided
        description: 'Broken skill',
        identifier: 'broken',
        name: 'Broken',
      },
      {
        description: 'Working skill',
        identifier: 'working',
        name: 'Working',
      },
    ];
    const provider = new SkillContextProvider({ enabledSkills: skills });

    const messages = [{ content: 'Hello', id: 'u1', role: 'user' }];
    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    // Broken skill (activated but no content) should fall through to available list
    expect(systemMessage!.content).toContain('<available_skills>');
    expect(systemMessage!.content).toContain('Working');
  });

  it('should only inject lightweight metadata without content field', async () => {
    const skills: SkillMeta[] = [
      {
        description: 'Generate interactive UI components',
        identifier: 'artifacts',
        location: '/path/to/skills/artifacts/SKILL.md',
        name: 'Artifacts',
      },
    ];
    const provider = new SkillContextProvider({ enabledSkills: skills });

    const messages = [{ content: 'Hello', id: 'u1', role: 'user' }];
    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage!.content).not.toContain('<content>');
    expect(systemMessage!.content).toMatchSnapshot();
  });

  describe('session-created skills (prompt cache stability)', () => {
    it('omits a skill created via lobe-skill-store in flat tool history from <available_skills>', async () => {
      const skills: SkillMeta[] = [
        {
          description: 'Newly installed PPT skill',
          identifier: 'market-pptx',
          name: 'pptx',
        },
        { description: 'Existing skill', identifier: 'doc-writer', name: 'doc-writer' },
      ];
      const provider = new SkillContextProvider({ enabledSkills: skills });

      const messages = [
        { content: 'Install pptx', id: 'u1', role: 'user' },
        {
          content: 'Skill "pptx" created successfully from market.',
          id: 't1',
          plugin: { apiName: 'importFromMarket', identifier: 'lobe-skill-store' },
          pluginState: { name: 'pptx', skillId: 'skl_1', status: 'created', success: true },
          role: 'tool',
        },
        { content: 'Make a deck', id: 'u2', role: 'user' },
      ];

      const result = await provider.process(createContext(messages));
      const systemMessage = result.messages.find((msg) => msg.role === 'system');

      expect(systemMessage!.content).not.toContain('<skill name="pptx">');
      expect(systemMessage!.content).toContain('<skill name="doc-writer">');
      expect(result.metadata.skillContext).toEqual({ injected: true, skillsCount: 1 });
    });

    it('omits a skill created via lobe-skill-store in assistantGroup history', async () => {
      const skills: SkillMeta[] = [
        { description: 'Find skills', identifier: 'find-skills-id', name: 'find-skills' },
        { description: 'Existing skill', identifier: 'doc-writer', name: 'doc-writer' },
      ];
      const provider = new SkillContextProvider({ enabledSkills: skills });

      const messages = [
        { content: 'Install a skill', id: 'u1', role: 'user' },
        {
          children: [
            {
              content: '',
              id: 'a1',
              tools: [
                {
                  apiName: 'importSkill',
                  id: 'tc1',
                  identifier: 'lobe-skill-store',
                  result: {
                    content: 'Skill "find-skills" created successfully.',
                    state: {
                      name: 'find-skills',
                      skillId: 'skl_2',
                      status: 'created',
                      success: true,
                    },
                  },
                },
              ],
            },
          ],
          content: '',
          id: 'g1',
          role: 'assistantGroup',
        },
        { content: 'Next turn', id: 'u2', role: 'user' },
      ];

      const result = await provider.process(createContext(messages));
      const systemMessage = result.messages.find((msg) => msg.role === 'system');

      expect(systemMessage!.content).not.toContain('<skill name="find-skills">');
      expect(systemMessage!.content).toContain('<skill name="doc-writer">');
    });

    it('skips injection entirely when the only enabled skill was created in this session', async () => {
      const skills: SkillMeta[] = [
        { description: 'Newly installed', identifier: 'find-skills-id', name: 'find-skills' },
      ];
      const provider = new SkillContextProvider({ enabledSkills: skills });

      const messages = [
        { content: 'Install', id: 'u1', role: 'user' },
        {
          content: 'Skill "find-skills" created successfully from market.',
          id: 't1',
          plugin: { apiName: 'importFromMarket', identifier: 'lobe-skill-store' },
          pluginState: { name: 'find-skills', skillId: 'skl_1', status: 'created', success: true },
          role: 'tool',
        },
        { content: 'Continue', id: 'u2', role: 'user' },
      ];

      const result = await provider.process(createContext(messages));
      expect(result.messages.find((msg) => msg.role === 'system')).toBeUndefined();
      expect(result.metadata.skillContext).toBeUndefined();
    });

    it('keeps skills whose import status was updated, unchanged, or failed', async () => {
      const skills: SkillMeta[] = [
        { description: 'Updated skill', identifier: 's1', name: 'updated-skill' },
        { description: 'Unchanged skill', identifier: 's2', name: 'unchanged-skill' },
        { description: 'Failed skill', identifier: 's3', name: 'failed-skill' },
      ];
      const provider = new SkillContextProvider({ enabledSkills: skills });

      const messages = [
        {
          content: 'updated',
          id: 't1',
          plugin: { apiName: 'importFromMarket', identifier: 'lobe-skill-store' },
          pluginState: { name: 'updated-skill', status: 'updated', success: true },
          role: 'tool',
        },
        {
          content: 'unchanged',
          id: 't2',
          plugin: { apiName: 'importFromMarket', identifier: 'lobe-skill-store' },
          pluginState: { name: 'unchanged-skill', status: 'unchanged', success: true },
          role: 'tool',
        },
        {
          content: 'failed',
          id: 't3',
          plugin: { apiName: 'importSkill', identifier: 'lobe-skill-store' },
          pluginState: { name: 'failed-skill', status: 'created', success: false },
          role: 'tool',
        },
      ];

      const result = await provider.process(createContext(messages));
      const systemMessage = result.messages.find((msg) => msg.role === 'system');

      expect(systemMessage!.content).toContain('<skill name="updated-skill">');
      expect(systemMessage!.content).toContain('<skill name="unchanged-skill">');
      expect(systemMessage!.content).toContain('<skill name="failed-skill">');
    });

    it('keeps a filesystem skill listed when a same-named skill is created in this session', async () => {
      // The pool keeps the project skill over the new library skill of the same name,
      // so the listed entry is the one that was already there on the previous turn.
      const skills: SkillMeta[] = [
        {
          description: 'Project PPT skill',
          identifier: 'project:pptx',
          location: '/repo/.agents/skills/pptx/SKILL.md',
          name: 'pptx',
          source: 'project',
        },
        {
          description: 'Device chart skill',
          identifier: 'device:chart',
          location: '/home/me/.agents/skills/chart/SKILL.md',
          name: 'chart',
          source: 'device',
        },
      ];
      const provider = new SkillContextProvider({ enabledSkills: skills });

      const messages = [
        {
          content: 'Skill "pptx" created successfully from market.',
          id: 't1',
          plugin: { apiName: 'importFromMarket', identifier: 'lobe-skill-store' },
          pluginState: { name: 'pptx', skillId: 'skl_1', status: 'created', success: true },
          role: 'tool',
        },
        {
          content: 'Skill "chart" created successfully.',
          id: 't2',
          plugin: { apiName: 'importSkill', identifier: 'lobe-skill-store' },
          pluginState: { name: 'chart', skillId: 'skl_2', status: 'created', success: true },
          role: 'tool',
        },
      ];

      const result = await provider.process(createContext(messages));
      const systemMessage = result.messages.find((msg) => msg.role === 'system');

      expect(systemMessage!.content).toContain('<skill name="pptx"');
      expect(systemMessage!.content).toContain('<skill name="chart"');
      expect(result.metadata.skillContext).toEqual({ injected: true, skillsCount: 2 });
    });

    it('keeps a listed skill whose name differs from the created one only by case', async () => {
      const skills: SkillMeta[] = [
        { description: 'Existing skill', identifier: 'pptx-upper', name: 'PPTX' },
        { description: 'Newly installed', identifier: 'market-pptx', name: 'pptx' },
      ];
      const provider = new SkillContextProvider({ enabledSkills: skills });

      const messages = [
        {
          content: 'Skill "pptx" created successfully from market.',
          id: 't1',
          plugin: { apiName: 'importFromMarket', identifier: 'lobe-skill-store' },
          pluginState: { name: 'pptx', skillId: 'skl_1', status: 'created', success: true },
          role: 'tool',
        },
      ];

      const result = await provider.process(createContext(messages));
      const systemMessage = result.messages.find((msg) => msg.role === 'system');

      expect(systemMessage!.content).toContain('<skill name="PPTX">');
      expect(systemMessage!.content).not.toContain('<skill name="pptx">');
    });

    it('keeps a session-created skill listed once its import turn is compressed into compressedGroup', async () => {
      const skills: SkillMeta[] = [
        { description: 'PPT skill', identifier: 'pptx-id', name: 'pptx' },
      ];
      const provider = new SkillContextProvider({ enabledSkills: skills });

      const messages = [
        {
          compressedMessages: [
            {
              content: 'Skill "pptx" created successfully from market.',
              id: 't1',
              plugin: { apiName: 'importFromMarket', identifier: 'lobe-skill-store' },
              pluginState: { name: 'pptx', skillId: 'skl_1', status: 'created', success: true },
              role: 'tool',
            },
          ],
          content: 'Earlier summary',
          id: 'cg1',
          role: 'compressedGroup',
        },
        { content: 'Make another deck', id: 'u2', role: 'user' },
      ];

      const result = await provider.process(createContext(messages));
      const systemMessage = result.messages.find((msg) => msg.role === 'system');

      expect(systemMessage!.content).toContain('<skill name="pptx">');
    });

    it('still injects explicitly activated skills with content even if created in this session', async () => {
      const skills: SkillMeta[] = [
        {
          activated: true,
          content: '<skill_body>Full pptx instructions</skill_body>',
          description: 'PPT skill',
          identifier: 'pptx-id',
          name: 'pptx',
        },
      ];
      const provider = new SkillContextProvider({ enabledSkills: skills });

      const messages = [
        {
          content: 'Skill "pptx" created successfully from market.',
          id: 't1',
          plugin: { apiName: 'importFromMarket', identifier: 'lobe-skill-store' },
          pluginState: { name: 'pptx', skillId: 'skl_1', status: 'created', success: true },
          role: 'tool',
        },
      ];

      const result = await provider.process(createContext(messages));
      const systemMessage = result.messages.find((msg) => msg.role === 'system');

      expect(systemMessage!.content).toContain('<skill_body>Full pptx instructions</skill_body>');
    });
  });
});
