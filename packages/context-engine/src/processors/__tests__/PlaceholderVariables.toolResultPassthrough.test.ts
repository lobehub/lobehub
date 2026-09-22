import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { HYDRATED_TOOL_RESULTS, PlaceholderVariablesProcessor } from '../PlaceholderVariables';

/**
 * Regression for the prompt-cache break caused by rewriting tool results.
 *
 * An agent ran `git diff` over `locales/en-US/chat.json`, whose i18n source
 * string is literally `"Updated {{time}}"`. The diff landed in a tool result
 * 66k tokens into the context, and because the processor substituted `{{time}}`
 * into *every* message on *every* call, that historical result changed its
 * seconds each time — diverging from the prefix the provider had already cached
 * and forcing all ~300k following tokens to be re-processed at the uncached
 * price. 134 of 136 calls broke, 43M tokens re-processed, $15.47 for one run
 * against a $0.59 baseline.
 *
 * A tool result is a record of what the tool returned. Only the activation
 * tools return a template that still needs hydrating.
 */
describe('PlaceholderVariablesProcessor — tool result passthrough', () => {
  const buildContext = (messages: any[]): PipelineContext => ({
    initialState: { messages: [] },
    isAborted: false,
    messages,
    metadata: {},
  });

  const timeGenerators = { time: () => new Date().toISOString(), topic_id: () => 'tpc_abc' };

  it('leaves a {{time}} that a tool genuinely returned untouched', async () => {
    const processor = new PlaceholderVariablesProcessor({ variableGenerators: timeGenerators });

    const diff = '+  "workingPanel.resources.updatedAt": "Updated {{time}}",';
    const ctx = buildContext([
      {
        role: 'tool',
        tool_call_id: 't1',
        name: 'lobe-local-system____runCommand',
        content: diff,
      },
    ]);

    const result = await processor.process(ctx);

    expect(result.messages[0].content).toBe(diff);
  });

  it('renders the same tool result identically across repeated calls', async () => {
    const diff = 'Updated {{time}} / {{timestamp}}';
    const render = async () => {
      const processor = new PlaceholderVariablesProcessor({
        variableGenerators: {
          time: () => new Date().toISOString(),
          timestamp: () => Date.now().toString(),
        },
      });
      const ctx = buildContext([
        {
          role: 'tool',
          tool_call_id: 't1',
          name: 'lobe-local-system____runCommand',
          content: diff,
        },
      ]);
      return (await processor.process(ctx)).messages[0].content;
    };

    // Byte-stability across calls is the whole point: an unstable byte here is
    // a broken cache prefix and a ~50x price on every token that follows.
    expect(await render()).toBe(await render());
  });

  it('identifies the tool from `plugin` when the wire name is absent', async () => {
    const processor = new PlaceholderVariablesProcessor({ variableGenerators: timeGenerators });

    const ctx = buildContext([
      {
        role: 'tool',
        tool_call_id: 't1',
        plugin: { apiName: 'runCommand', identifier: 'lobe-local-system' },
        content: 'at {{time}}',
      },
      {
        role: 'tool',
        tool_call_id: 't2',
        plugin: { apiName: 'activateSkill', identifier: 'lobe-skills' },
        content: 'topic {{topic_id}}',
      },
    ]);

    const result = await processor.process(ctx);

    expect(result.messages[0].content).toBe('at {{time}}');
    expect(result.messages[1].content).toBe('topic tpc_abc');
  });

  it('passes through a tool result that carries no identity at all', async () => {
    const processor = new PlaceholderVariablesProcessor({ variableGenerators: timeGenerators });

    const ctx = buildContext([
      { role: 'tool', tool_call_id: 't1', name: 'foo', content: 'at {{time}}' },
    ]);

    const result = await processor.process(ctx);

    expect(result.messages[0].content).toBe('at {{time}}');
  });

  it('still hydrates the system prompt and the user turn', async () => {
    const processor = new PlaceholderVariablesProcessor({ variableGenerators: timeGenerators });

    const ctx = buildContext([
      { role: 'system', content: 'topic {{topic_id}}' },
      // A user who types `{{time}}` wants a live clock — that path is untouched.
      { role: 'user', content: 'now is {{time}}' },
      { role: 'assistant', content: 'topic {{topic_id}}' },
    ]);

    const result = await processor.process(ctx);

    expect(result.messages[0].content).toBe('topic tpc_abc');
    expect(result.messages[1].content).not.toContain('{{time}}');
    expect(result.messages[2].content).toBe('topic tpc_abc');
  });

  it('honours a caller-supplied allowlist', async () => {
    const processor = new PlaceholderVariablesProcessor({
      hydratedToolResults: { 'lobe-local-system': ['runCommand'] },
      variableGenerators: { topic_id: () => 'tpc_abc' },
    });

    const ctx = buildContext([
      {
        role: 'tool',
        tool_call_id: 't1',
        name: 'lobe-local-system____runCommand',
        content: 'topic {{topic_id}}',
      },
      {
        role: 'tool',
        tool_call_id: 't2',
        name: 'lobe-skills____activateSkill',
        content: 'topic {{topic_id}}',
      },
    ]);

    const result = await processor.process(ctx);

    expect(result.messages[0].content).toBe('topic tpc_abc');
    // Not in the supplied allowlist — the default no longer applies.
    expect(result.messages[1].content).toBe('topic {{topic_id}}');
  });

  it('covers the activation surface ActivationResultTrimProcessor recognises', () => {
    // Both processors must agree on which tool results are platform-authored
    // documents; a skill activated but not injected keeps its tool result as the
    // only channel for a SKILL.md body that references {{agent_id}}.
    expect(HYDRATED_TOOL_RESULTS['lobe-activator']).toContain('activateTools');
    expect(HYDRATED_TOOL_RESULTS['lobe-activator']).toContain('activateSkill');
    expect(HYDRATED_TOOL_RESULTS['lobe-skills']).toContain('activateSkill');
  });
});
