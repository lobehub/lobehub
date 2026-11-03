import { describe, expect, it } from 'vitest';

import {
  applyInstalledMarketAgents,
  collectPendingMarketAgents,
  collectPendingMarketSkills,
  marketAgentMentionId,
} from './marketMention';

const mention = (label: string, metadata: Record<string, unknown>) => ({
  label,
  metadata,
  type: 'mention',
});

const skillTag = (actionType: string, actionLabel = actionType) => ({
  actionCategory: 'skill',
  actionLabel,
  actionType,
  type: 'action-tag',
});

const doc = (...children: unknown[]) => ({
  root: { children: [{ children, type: 'paragraph' }], type: 'root' },
});

const marketAgent = (identifier: string, visibility: 'private' | 'public' = 'public') =>
  mention(identifier.toUpperCase(), {
    id: marketAgentMentionId(identifier),
    label: identifier.toUpperCase(),
    marketIdentifier: identifier,
    marketVisibility: visibility,
    type: 'agent',
  });

describe('collectPendingMarketAgents', () => {
  it('returns each market agent once, ignoring installed agents and other mentions', () => {
    const editorData = doc(
      marketAgent('writer', 'private'),
      mention('Local', { id: 'agt_1', label: 'Local', type: 'agent' }),
      mention('Topic', { topicId: 'tpc_1', type: 'topic' }),
      marketAgent('writer', 'private'),
      marketAgent('coder'),
    );

    expect(collectPendingMarketAgents(editorData)).toEqual([
      { identifier: 'writer', label: 'WRITER', visibility: 'private' },
      { identifier: 'coder', label: 'CODER', visibility: 'public' },
    ]);
  });

  it('ignores a mention whose id was already resolved', () => {
    const resolved = mention('Writer', {
      id: 'agt_9',
      label: 'Writer',
      marketIdentifier: 'writer',
      type: 'agent',
    });

    expect(collectPendingMarketAgents(doc(resolved))).toEqual([]);
  });
});

describe('collectPendingMarketSkills', () => {
  it('returns skill tags that are not installed, deduped, with their display names', () => {
    const editorData = doc(
      skillTag('installed-skill'),
      skillTag('market-skill', '营销文案'),
      skillTag('market-skill', '营销文案'),
      skillTag('unlabeled-skill', ''),
      { actionCategory: 'tool', actionLabel: 'T', actionType: 'some-tool', type: 'action-tag' },
    );

    expect(collectPendingMarketSkills(editorData, new Set(['installed-skill']))).toEqual([
      { identifier: 'market-skill', label: '营销文案' },
      { identifier: 'unlabeled-skill', label: 'unlabeled-skill' },
    ]);
  });
});

describe('applyInstalledMarketAgents', () => {
  it('points the chip and the markdown at the installed agent', () => {
    const editorData = doc(marketAgent('writer'), marketAgent('coder'));
    const markdown = `<mention name="WRITER" id="${marketAgentMentionId('writer')}" /> and <mention name="CODER" id="${marketAgentMentionId('coder')}" /> hi <mention name="WRITER" id="${marketAgentMentionId('writer')}" />`;

    const result = applyInstalledMarketAgents(
      { editorData, markdown },
      new Map([
        ['writer', 'agt_w'],
        ['coder', 'agt_c'],
      ]),
    );

    expect(result.markdown).toBe(
      '<mention name="WRITER" id="agt_w" /> and <mention name="CODER" id="agt_c" /> hi <mention name="WRITER" id="agt_w" />',
    );
    const chips = (result.editorData as any).root.children[0].children;
    expect(chips[0].metadata).toEqual({ id: 'agt_w', label: 'WRITER', type: 'agent' });
    expect(chips[1].metadata).toEqual({ id: 'agt_c', label: 'CODER', type: 'agent' });
    expect(collectPendingMarketAgents(result.editorData)).toEqual([]);
    // The caller's editor JSON stays untouched.
    expect(collectPendingMarketAgents(editorData)).toHaveLength(2);
  });

  it('keeps market agents that were not installed pending', () => {
    const editorData = doc(marketAgent('writer'));
    const markdown = `<mention name="WRITER" id="${marketAgentMentionId('writer')}" />`;

    const result = applyInstalledMarketAgents({ editorData, markdown }, new Map());

    expect(result.markdown).toBe(markdown);
    expect(collectPendingMarketAgents(result.editorData)).toHaveLength(1);
  });
});
