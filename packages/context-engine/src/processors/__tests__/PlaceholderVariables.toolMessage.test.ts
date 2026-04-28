import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { PlaceholderVariablesProcessor } from '../PlaceholderVariables';

/**
 * Regression for LOBE-6882 placeholder approach.
 *
 * Confirms that PlaceholderVariablesProcessor does substitute `{{...}}` tokens
 * inside `role: 'tool'` messages. If this test ever fails, it means the
 * processor is silently skipping tool messages and the lobehub skill identity
 * placeholders won't be filled in after the model calls
 * `lobe-activator.activateSkill('lobehub')`.
 */
describe('PlaceholderVariablesProcessor — tool message substitution', () => {
  const buildContext = (messages: any[]): PipelineContext => ({
    initialState: { messages: [] },
    isAborted: false,
    messages,
    metadata: {},
  });

  it('substitutes placeholders inside a string-content tool message', async () => {
    const processor = new PlaceholderVariablesProcessor({
      variableGenerators: {
        agent_id: () => 'agt_xyz',
        agent_title: () => 'Test Agent',
        topic_id: () => 'tpc_abc',
      },
    });

    const ctx = buildContext([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'toolu_1',
            type: 'function',
            function: { name: 'lobe-activator____activateSkill____builtin', arguments: '{}' },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'toolu_1',
        name: 'lobe-activator____activateSkill____builtin',
        content:
          '<lobehub_platform_guides>\n| Agent ID | `{{agent_id}}` |\n| Agent Title | {{agent_title}} |\n| Topic ID | `{{topic_id}}` |\n</lobehub_platform_guides>',
      },
    ]);

    const result = await processor.process(ctx);

    const toolMessage = result.messages[3];
    expect(toolMessage.role).toBe('tool');
    expect(toolMessage.content).toContain('agt_xyz');
    expect(toolMessage.content).toContain('Test Agent');
    expect(toolMessage.content).toContain('tpc_abc');
    expect(toolMessage.content).not.toContain('{{agent_id}}');
    expect(toolMessage.content).not.toContain('{{agent_title}}');
    expect(toolMessage.content).not.toContain('{{topic_id}}');
  });

  it('preserves placeholder when matching generator is missing', async () => {
    const processor = new PlaceholderVariablesProcessor({
      variableGenerators: {
        // intentionally NO agent_id
      },
    });

    const ctx = buildContext([
      { role: 'tool', tool_call_id: 't1', name: 'foo', content: 'agent={{agent_id}}' },
    ]);

    const result = await processor.process(ctx);
    expect(result.messages[0].content).toBe('agent={{agent_id}}');
  });

  it('substitutes generator returning empty string to empty (NOT raw)', async () => {
    const processor = new PlaceholderVariablesProcessor({
      variableGenerators: {
        agent_id: () => '',
      },
    });

    const ctx = buildContext([
      { role: 'tool', tool_call_id: 't1', name: 'foo', content: 'agent=[{{agent_id}}]' },
    ]);

    const result = await processor.process(ctx);
    // Empty string is a valid replacement value — must NOT preserve `{{agent_id}}`
    expect(result.messages[0].content).toBe('agent=[]');
  });
});
