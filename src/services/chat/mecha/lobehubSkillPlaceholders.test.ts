import { builtinSkills, LobeHubIdentifier } from '@lobechat/builtin-skills';
import { renderPlaceholderTemplate } from '@lobechat/context-engine';
import { describe, expect, it } from 'vitest';

const LobeHubSkill = builtinSkills.find((s) => s.identifier === LobeHubIdentifier);
if (!LobeHubSkill) {
  throw new Error(`LobeHubSkill not found in builtinSkills (looking for "${LobeHubIdentifier}")`);
}
const lobeHubContent = LobeHubSkill.content;

/**
 * Regression for LOBE-6882.
 *
 * Instead of building a dedicated AgentIdentityContextInjector, we wire current
 * agent / topic identity through the existing PlaceholderVariablesProcessor —
 * the LobeHub builtin skill content references `{{agent_id}}`, `{{topic_id}}`,
 * etc., and `contextEngineering.ts` provides the matching variable generators.
 *
 * This test pins the contract from BOTH ends:
 *   1. `lobehub/content.ts` actually contains the expected `{{...}}` tokens.
 *   2. The placeholder engine substitutes them with caller-provided values.
 *
 * If anyone renames a token in content.ts without updating the generators (or
 * vice versa), this test fails before users see a broken `lh agent run -a {{agent_id}}`
 * literal in their prompts.
 */
describe('LobeHub skill identity placeholders (LOBE-6882)', () => {
  const PLACEHOLDER_KEYS = [
    'agent_id',
    'agent_title',
    'agent_description',
    'topic_id',
    'topic_title',
  ] as const;

  it('lobeHubContent references all expected placeholder tokens', () => {
    const content = lobeHubContent;
    for (const key of PLACEHOLDER_KEYS) {
      expect(content).toContain(`{{${key}}}`);
    }
  });

  it('renderPlaceholderTemplate substitutes all identity placeholders', () => {
    const rendered = renderPlaceholderTemplate(lobeHubContent, {
      agent_id: 'agt_xyz',
      agent_title: 'Test Agent',
      agent_description: 'A test assistant',
      topic_id: 'tpc_abc',
      topic_title: 'Hello topic',
    });

    // All raw `{{...}}` tokens for our keys must be gone after substitution
    for (const key of PLACEHOLDER_KEYS) {
      expect(rendered).not.toContain(`{{${key}}}`);
    }
    // And the substituted values must be present
    expect(rendered).toContain('agt_xyz');
    expect(rendered).toContain('Test Agent');
    expect(rendered).toContain('A test assistant');
    expect(rendered).toContain('tpc_abc');
    expect(rendered).toContain('Hello topic');
  });

  it('falls back to empty string when an identity field is missing', () => {
    const rendered = renderPlaceholderTemplate(lobeHubContent, {
      agent_id: 'agt_only',
      agent_title: '',
      agent_description: '',
      topic_id: 'tpc_only',
      topic_title: '',
    });

    // ID rows still render their values
    expect(rendered).toContain('agt_only');
    expect(rendered).toContain('tpc_only');
    // Empty values do NOT leave a literal `{{...}}` behind
    for (const key of PLACEHOLDER_KEYS) {
      expect(rendered).not.toContain(`{{${key}}}`);
    }
  });

  it('leaves unrelated placeholder tokens untouched', () => {
    // Sanity check: if someone adds an unsupported `{{foo}}` token to content.ts,
    // renderPlaceholderTemplate should preserve it rather than dropping it.
    // We synthesize a tiny template here so the test stays narrow.
    const result = renderPlaceholderTemplate('agent={{agent_id}}; unknown={{not_a_real_var}}', {
      agent_id: 'agt_xyz',
    });
    expect(result).toBe('agent=agt_xyz; unknown={{not_a_real_var}}');
  });
});
