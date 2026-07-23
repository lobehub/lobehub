import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  collectFromMessages,
  extractActivatedSkillsFromMessages,
  extractActivatedToolIdsFromMessages,
  findInMessages,
} from './messageSelectors';

const createMessage = (overrides: Partial<UIChatMessage> = {}): UIChatMessage =>
  ({
    content: '',
    createdAt: Date.now(),
    id: 'msg-1',
    role: 'assistant',
    updatedAt: Date.now(),
    ...overrides,
  }) as UIChatMessage;

const createToolMessage = (overrides: Partial<UIChatMessage> = {}): UIChatMessage =>
  createMessage({ role: 'tool', ...overrides });

describe('findInMessages', () => {
  it('should return undefined for empty messages', () => {
    const result = findInMessages([], () => 'found');
    expect(result).toBeUndefined();
  });

  it('should return first match scanning from newest', () => {
    const messages = [
      createMessage({ content: 'old', id: '1' }),
      createMessage({ content: 'new', id: '2' }),
    ];

    const result = findInMessages(messages, (msg) => {
      if (msg.content) return msg.content;
    });

    expect(result).toBe('new');
  });

  it('should filter by role', () => {
    const messages = [
      createMessage({ content: 'assistant-msg', role: 'assistant' } as any),
      createToolMessage({ content: 'tool-msg' }),
    ];

    const result = findInMessages(messages, (msg) => msg.content || undefined, { role: 'tool' });

    expect(result).toBe('tool-msg');
  });

  it('should skip messages where visitor returns undefined', () => {
    const messages = [
      createToolMessage({ id: '1', pluginState: undefined }),
      createToolMessage({ id: '2', pluginState: { value: 42 } }),
    ];

    const result = findInMessages(messages, (msg) => msg.pluginState?.value as number | undefined, {
      role: 'tool',
    });

    expect(result).toBe(42);
  });
});

describe('collectFromMessages', () => {
  it('should return empty array for no matches', () => {
    const result = collectFromMessages([], () => 'found');
    expect(result).toEqual([]);
  });

  it('should collect all matches in forward order', () => {
    const messages = [
      createToolMessage({ id: '1', pluginState: { v: 'a' } }),
      createToolMessage({ id: '2', pluginState: { v: 'b' } }),
      createToolMessage({ id: '3', pluginState: undefined }),
    ];

    const result = collectFromMessages(
      messages,
      (msg) => msg.pluginState?.v as string | undefined,
      { role: 'tool' },
    );

    expect(result).toEqual(['a', 'b']);
  });

  it('should filter by role', () => {
    const messages = [
      createMessage({ content: 'user', role: 'user' } as any),
      createToolMessage({ content: 'tool' }),
    ];

    const result = collectFromMessages(messages, (msg) => msg.content || undefined, {
      role: 'tool',
    });

    expect(result).toEqual(['tool']);
  });
});

describe('extractActivatedSkillsFromMessages', () => {
  it('should return undefined when no skill activations exist', () => {
    const messages = [
      createMessage({ content: 'hi', role: 'user' } as any),
      createToolMessage({ plugin: { apiName: 'execScript', identifier: 'lobe-skills' } } as any),
    ];

    expect(extractActivatedSkillsFromMessages(messages)).toBeUndefined();
  });

  it('should extract skills from direct activateSkill results', () => {
    const messages = [
      createToolMessage({
        plugin: { apiName: 'activateSkill', identifier: 'lobe-skills' },
        pluginState: { description: 'PDF tools', id: 'skl_1', name: 'pdf' },
      } as any),
    ];

    expect(extractActivatedSkillsFromMessages(messages)).toEqual([
      { description: 'PDF tools', id: 'skl_1', name: 'pdf' },
    ]);
  });

  it('should extract skills from activator activateSkill and activateTools results', () => {
    const messages = [
      createToolMessage({
        plugin: { apiName: 'activateSkill', identifier: 'lobe-activator' },
        pluginState: { id: 'skl_1', name: 'pdf' },
      } as any),
      createToolMessage({
        plugin: { apiName: 'activateTools', identifier: 'lobe-activator' },
        pluginState: {
          activatedSkills: [
            { description: 'sheets', id: 'skl_2', name: 'xlsx' },
            { id: 'missing-name-dropped' },
          ],
        },
      } as any),
    ];

    expect(extractActivatedSkillsFromMessages(messages)).toEqual([
      { description: undefined, id: 'skl_1', name: 'pdf' },
      { description: 'sheets', id: 'skl_2', name: 'xlsx' },
    ]);
  });

  it('should deduplicate by skill id with later activations winning', () => {
    const messages = [
      createToolMessage({
        plugin: { apiName: 'activateSkill', identifier: 'lobe-skills' },
        pluginState: { description: 'old', id: 'skl_1', name: 'pdf' },
      } as any),
      createToolMessage({
        plugin: { apiName: 'activateSkill', identifier: 'lobe-skills' },
        pluginState: { description: 'new', id: 'skl_1', name: 'pdf' },
      } as any),
    ];

    expect(extractActivatedSkillsFromMessages(messages)).toEqual([
      { description: 'new', id: 'skl_1', name: 'pdf' },
    ]);
  });

  // Exec paths pick the LAST entry as the most recent activation for the
  // script cwd, so a reactivation must move the skill to the end.
  it('should move a reactivated skill to the end of the activation order', () => {
    const activate = (id: string, name: string) =>
      createToolMessage({
        plugin: { apiName: 'activateSkill', identifier: 'lobe-skills' },
        pluginState: { id, name },
      } as any);

    const messages = [
      activate('skl_a', 'alpha'),
      activate('skl_b', 'beta'),
      activate('skl_a', 'alpha'),
    ];

    expect(extractActivatedSkillsFromMessages(messages)).toEqual([
      { description: undefined, id: 'skl_b', name: 'beta' },
      { description: undefined, id: 'skl_a', name: 'alpha' },
    ]);
  });

  // Filesystem (project/device) and builtin skill activations persist no DB
  // id — dropping them broke device-exec cwd resolution, which matches
  // activated skills against device.projectSkills by name.
  it('should keep activateSkill states without an id (filesystem/builtin skills)', () => {
    const messages = [
      createToolMessage({
        plugin: { apiName: 'activateSkill', identifier: 'lobe-skills' },
        pluginState: {
          hasResources: false,
          location: '/repo/.agents/skills/foo/SKILL.md',
          name: 'foo',
          source: 'project',
        },
      } as any),
      createToolMessage({
        plugin: { apiName: 'activateTools', identifier: 'lobe-activator' },
        pluginState: { activatedSkills: [{ description: 'builtin', name: 'bar' }] },
      } as any),
    ];

    expect(extractActivatedSkillsFromMessages(messages)).toEqual([
      { description: undefined, name: 'foo' },
      { description: 'builtin', name: 'bar' },
    ]);
  });

  it('should deduplicate id-less activations by name with later activations winning', () => {
    const messages = [
      createToolMessage({
        plugin: { apiName: 'activateSkill', identifier: 'lobe-skills' },
        pluginState: { name: 'foo', source: 'project' },
      } as any),
      createToolMessage({
        plugin: { apiName: 'activateSkill', identifier: 'lobe-skills' },
        pluginState: { description: 'reactivated', name: 'foo', source: 'project' },
      } as any),
    ];

    expect(extractActivatedSkillsFromMessages(messages)).toEqual([
      { description: 'reactivated', name: 'foo' },
    ]);
  });

  it('should ignore non-tool roles and other tool identifiers', () => {
    const messages = [
      createMessage({
        plugin: { apiName: 'activateSkill', identifier: 'lobe-skills' },
        pluginState: { id: 'skl_1', name: 'pdf' },
        role: 'assistant',
      } as any),
      createToolMessage({
        plugin: { apiName: 'activateSkill', identifier: 'lobe-web-browsing' },
        pluginState: { id: 'skl_2', name: 'web' },
      } as any),
    ];

    expect(extractActivatedSkillsFromMessages(messages)).toBeUndefined();
  });

  // The server runtime rehydrates state.messages from the DB at every step
  // (rehydrateStateMessagesFromDB), which runs conversation-flow parse():
  // completed turns are folded into assistantGroup virtual nodes where tool
  // rows live on children[].tools[] with pluginState as result.state.
  it('should extract skills folded into assistantGroup nodes (cross-turn rehydrated state)', () => {
    const messages = [
      createMessage({ content: 'activate xlsx', role: 'user' } as any),
      createMessage({
        children: [
          {
            content: '',
            id: 'msg-asst-1',
            tools: [
              {
                apiName: 'activateSkill',
                arguments: '{"name":"xlsx"}',
                id: 'call_1',
                identifier: 'lobe-skills',
                result: {
                  content: 'activated',
                  id: 'msg-tool-1',
                  state: { description: 'sheets', id: 'skl_1', name: 'xlsx' },
                },
              },
            ],
          },
          {
            content: 'done',
            id: 'msg-asst-2',
            tools: [
              {
                apiName: 'execScript',
                id: 'call_2',
                identifier: 'lobe-skills',
                result: { content: 'ok', id: 'msg-tool-2', state: { executionEnv: 'device' } },
              },
            ],
          },
        ],
        role: 'assistantGroup',
      } as any),
      createMessage({ content: 'run it again', role: 'user' } as any),
    ];

    expect(extractActivatedSkillsFromMessages(messages)).toEqual([
      { description: 'sheets', id: 'skl_1', name: 'xlsx' },
    ]);
  });

  it('should extract activateTools skills from assistantGroup nodes', () => {
    const messages = [
      createMessage({
        children: [
          {
            content: '',
            id: 'msg-asst-1',
            tools: [
              {
                apiName: 'activateTools',
                id: 'call_1',
                identifier: 'lobe-activator',
                result: {
                  content: 'activated',
                  id: 'msg-tool-1',
                  state: { activatedSkills: [{ id: 'skl_2', name: 'pdf' }] },
                },
              },
            ],
          },
        ],
        role: 'assistantGroup',
      } as any),
    ];

    expect(extractActivatedSkillsFromMessages(messages)).toEqual([
      { description: undefined, id: 'skl_2', name: 'pdf' },
    ]);
  });

  it('should recurse into compressedGroup compressedMessages', () => {
    const messages = [
      createMessage({
        compressedMessages: [
          createMessage({
            children: [
              {
                content: '',
                id: 'msg-asst-1',
                tools: [
                  {
                    apiName: 'activateSkill',
                    id: 'call_1',
                    identifier: 'lobe-skills',
                    result: {
                      content: 'ok',
                      id: 'msg-tool-1',
                      state: { id: 'skl_3', name: 'docx' },
                    },
                  },
                ],
              },
            ],
            role: 'assistantGroup',
          } as any),
        ],
        role: 'compressedGroup',
      } as any),
    ];

    expect(extractActivatedSkillsFromMessages(messages)).toEqual([
      { description: undefined, id: 'skl_3', name: 'docx' },
    ]);
  });

  it('should ignore assistantGroup tools without activation state or with other identifiers', () => {
    const messages = [
      createMessage({
        children: [
          {
            content: '',
            id: 'msg-asst-1',
            tools: [
              // Tool without a captured result (still pending)
              { apiName: 'activateSkill', id: 'call_1', identifier: 'lobe-skills' },
              // Non-skill identifier
              {
                apiName: 'activateSkill',
                id: 'call_2',
                identifier: 'lobe-web-browsing',
                result: { content: 'ok', id: 'msg-tool-2', state: { id: 'skl_9', name: 'web' } },
              },
            ],
          },
        ],
        role: 'assistantGroup',
      } as any),
    ];

    expect(extractActivatedSkillsFromMessages(messages)).toBeUndefined();
  });
});

describe('extractActivatedToolIdsFromMessages', () => {
  it('should accumulate and deduplicate tools from activator results', () => {
    const messages = [
      createToolMessage({
        plugin: { apiName: 'activateTools', identifier: 'lobe-activator' },
        pluginState: {
          activatedTools: [{ identifier: 'lobe-task' }, { identifier: 'lobe-calendar' }],
        },
      } as any),
      createToolMessage({
        plugin: { apiName: 'activateTools', identifier: 'lobe-activator' },
        pluginState: { activatedTools: [{ identifier: 'lobe-task' }] },
      } as any),
    ];

    expect(extractActivatedToolIdsFromMessages(messages)).toEqual(['lobe-task', 'lobe-calendar']);
  });

  it('should restore tools folded into an assistantGroup', () => {
    const messages = [
      createMessage({
        children: [
          {
            content: '',
            id: 'msg-asst-1',
            tools: [
              {
                apiName: 'activateTools',
                id: 'call-1',
                identifier: 'lobe-activator',
                result: {
                  content: 'activated',
                  id: 'msg-tool-1',
                  state: { activatedTools: [{ identifier: 'lobe-task' }] },
                },
              },
            ],
          },
        ],
        role: 'assistantGroup',
      } as any),
    ];

    expect(extractActivatedToolIdsFromMessages(messages)).toEqual(['lobe-task']);
  });

  it('should ignore failed or unrelated tool results', () => {
    const messages = [
      createToolMessage({
        plugin: { apiName: 'activateTools', identifier: 'another-tool' },
        pluginState: { activatedTools: [{ identifier: 'lobe-task' }] },
      } as any),
      createToolMessage({
        plugin: { apiName: 'activateTools', identifier: 'lobe-activator' },
        pluginState: { notFound: ['lobe-task'] },
      } as any),
    ];

    expect(extractActivatedToolIdsFromMessages(messages)).toBeUndefined();
  });
});
