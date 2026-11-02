import { ActivatorApiName, LobeActivatorManifest } from '@lobechat/builtin-tool-activator';
import {
  AgentDocumentsApiName,
  AgentDocumentsManifest,
} from '@lobechat/builtin-tool-agent-documents';
import { SkillsApiName, SkillsManifest } from '@lobechat/builtin-tool-skills';
import type { BuiltinToolManifest } from '@lobechat/types';
import { ON_DEMAND_BOOTSTRAP_IDENTIFIERS, ON_DEMAND_DYNAMIC_KINDS } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { ON_DEMAND_BOOTSTRAP_MANIFESTS } from '../bootstrapManifests';
import {
  buildOnDemandProtocol,
  buildOnDemandStablePrefix,
  validateOnDemandBootstrap,
  validateOnDemandStablePrefix,
} from '../protocolBuilder';
import { makeDynamicEntry } from './fixtures';

const emptyFixedTokens = {
  bootstrapTools: 0,
  currentUserMessage: 0,
  protocol: 0,
  userPrompt: 0,
};

describe('on-demand bootstrap manifests', () => {
  it('exposes only the real native bootstrap schemas', () => {
    expect(ON_DEMAND_BOOTSTRAP_MANIFESTS.map((manifest) => manifest.identifier)).toEqual(
      ON_DEMAND_BOOTSTRAP_IDENTIFIERS,
    );

    const activator = ON_DEMAND_BOOTSTRAP_MANIFESTS.find(
      (manifest) => manifest.identifier === 'lobe-activator',
    );
    const skills = ON_DEMAND_BOOTSTRAP_MANIFESTS.find(
      (manifest) => manifest.identifier === 'lobe-skills',
    );
    const documents = ON_DEMAND_BOOTSTRAP_MANIFESTS.find(
      (manifest) => manifest.identifier === 'lobe-agent-documents',
    );

    expect(activator?.api.map((api) => api.name)).toEqual([ActivatorApiName.activateTools]);
    expect(skills?.api.map((api) => api.name)).toEqual([
      SkillsApiName.activateSkill,
      SkillsApiName.readReference,
    ]);
    expect(documents?.api.map((api) => api.name)).toEqual([
      AgentDocumentsApiName.listDocuments,
      AgentDocumentsApiName.readDocument,
    ]);

    expect(activator?.api[0]).toEqual(LobeActivatorManifest.api[0]);
    expect(skills?.api[0]).toEqual(SkillsManifest.api[0]);
    expect(documents?.api[1]).toEqual(
      AgentDocumentsManifest.api.find((api) => api.name === AgentDocumentsApiName.readDocument),
    );
    expect(ON_DEMAND_BOOTSTRAP_MANIFESTS.flatMap((manifest) => manifest.api)).not.toContainEqual(
      expect.objectContaining({ name: 'invoke' }),
    );
  });

  it('rejects APIs outside the closed bootstrap allowlist', () => {
    const manifests = ON_DEMAND_BOOTSTRAP_MANIFESTS.map((manifest) => {
      if (manifest.identifier !== 'lobe-skills') return manifest;

      return {
        ...manifest,
        api: [
          ...manifest.api,
          {
            description: 'A forbidden generic execution entry.',
            name: 'invoke',
            parameters: { properties: {}, type: 'object' },
          },
        ],
      } satisfies BuiltinToolManifest;
    });

    const result = validateOnDemandBootstrap(manifests);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.code)).toContain('bootstrap_api_not_allowed');
    }
  });

  it('rejects identifiers outside the bootstrap allowlist', () => {
    const manifests = [
      ...ON_DEMAND_BOOTSTRAP_MANIFESTS.slice(1),
      {
        ...ON_DEMAND_BOOTSTRAP_MANIFESTS[0],
        identifier: 'general-invoke',
      },
    ];

    const result = validateOnDemandBootstrap(manifests);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.code)).toContain(
        'bootstrap_identifier_not_allowed',
      );
    }
  });
});

describe('buildOnDemandStablePrefix', () => {
  it('preserves the raw agent prompt and emits a fixed segment order', () => {
    const agentPrompt = '  user-authored\n\tprompt with spaces  ';
    const prefix = buildOnDemandStablePrefix({ agentPrompt });

    expect(prefix.agentPrompt.content).toBe(agentPrompt);
    expect(prefix.orderedSegments.map((segment) => segment.type)).toEqual([
      'agent_prompt',
      'protocol',
      'bootstrap_tool',
      'bootstrap_tool',
      'bootstrap_tool',
    ]);
    expect(
      prefix.orderedSegments
        .slice(2)
        .map((segment) => ('identifier' in segment ? segment.identifier : segment.type)),
    ).toEqual(ON_DEMAND_BOOTSTRAP_IDENTIFIERS);
  });

  it('produces the same hash for reordered manifests and object keys', () => {
    const reorderObjectKeys = (manifest: BuiltinToolManifest): BuiltinToolManifest =>
      Object.fromEntries(Object.entries(manifest).reverse()) as BuiltinToolManifest;
    const reordered = ON_DEMAND_BOOTSTRAP_MANIFESTS.map(reorderObjectKeys).reverse();

    const original = buildOnDemandStablePrefix({ agentPrompt: 'stable' });
    const shuffled = buildOnDemandStablePrefix({
      agentPrompt: 'stable',
      bootstrapManifests: reordered,
    });

    expect(shuffled).toEqual(original);
  });

  it('rejects dynamic content smuggled into the stable prefix', () => {
    const prefix = buildOnDemandStablePrefix({ agentPrompt: 'stable' });
    const tampered = {
      ...prefix,
      memory: [{ content: 'must stay dynamic' }],
    } as typeof prefix;

    const result = validateOnDemandStablePrefix(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.stringContaining('unsupported fields: agentPrompt,bootstrap,hash,memory'),
      );
    }
  });
});

describe('buildOnDemandProtocol', () => {
  it('preserves the current user message and only appends non-system messages', () => {
    const stablePrefix = buildOnDemandStablePrefix({ agentPrompt: 'agent prompt' });
    const systemMessage = Object.freeze({ content: 'system prompt', role: 'system' as const });
    const firstUserMessage = Object.freeze({
      content: 'first user message',
      role: 'user' as const,
    });
    const assistantMessage = Object.freeze({
      content: 'assistant reply',
      role: 'assistant' as const,
    });
    const currentUserMessage = Object.freeze({
      content: '  exact current user bytes\n\tstay here  ',
      id: 'message-1',
      role: 'user' as const,
    });
    const baseMessages = [systemMessage, firstUserMessage, assistantMessage, currentUserMessage];
    const entries = [
      makeDynamicEntry({ key: 'memory-1' }),
      makeDynamicEntry({ estimatedTokens: 5, key: 'safety-1', kind: 'safety' }),
    ];
    const entriesBefore = structuredClone(entries);
    const stablePrefixBefore = structuredClone(stablePrefix);

    const protocol = buildOnDemandProtocol({
      budget: { fixedTokens: emptyFixedTokens, maxTokens: 100 },
      currentUserMessage,
      entries,
      stablePrefix,
    });
    const composedMessages = [...baseMessages, ...protocol.appendedMessages];
    const currentUserIndex = composedMessages.indexOf(currentUserMessage);

    expect(protocol.currentUserMessage).toBe(currentUserMessage);
    expect(protocol.currentUserMessage.content).toBe(currentUserMessage.content);
    expect(composedMessages[0]).toBe(systemMessage);
    expect(composedMessages[1]).toBe(firstUserMessage);
    expect(composedMessages[currentUserIndex]).toBe(currentUserMessage);
    expect(currentUserIndex).toBe(baseMessages.length - 1);
    expect(composedMessages.slice(0, baseMessages.length)).toEqual(baseMessages);
    expect(protocol.appendedMessages).toHaveLength(2);
    expect(composedMessages[baseMessages.length]).toBe(protocol.appendedMessages[0]);
    expect(composedMessages.slice(0, baseMessages.length)).toEqual(baseMessages);
    expect(protocol.appendedMessages.every((message) => message.role === 'user')).toBe(true);
    expect(
      protocol.appendedMessages.every(
        (message) => message.metadata.position === 'after_current_user_message',
      ),
    ).toBe(true);
    expect(entries).toEqual(entriesBefore);
    expect(stablePrefix).toEqual(stablePrefixBefore);
  });

  it('is deterministic for reordered input and uses no random ids or timestamps', () => {
    const stablePrefix = buildOnDemandStablePrefix({ agentPrompt: 'agent prompt' });
    const currentUserMessage = { content: 'current', id: 'message-1', role: 'user' as const };
    const entries = [
      makeDynamicEntry({ key: 'memory-a', priority: 1, relevance: 0.5 }),
      makeDynamicEntry({
        estimatedTokens: 5,
        key: 'preference-b',
        kind: 'preference',
        priority: 3,
        relevance: 0.9,
      }),
    ];

    const first = buildOnDemandProtocol({
      budget: { fixedTokens: emptyFixedTokens, maxTokens: 100 },
      currentUserMessage,
      entries,
      stablePrefix,
    });
    const second = buildOnDemandProtocol({
      budget: { fixedTokens: emptyFixedTokens, maxTokens: 100 },
      currentUserMessage,
      entries: [...entries].reverse(),
      stablePrefix,
    });

    expect(second).toEqual(first);
    expect(first.hash).toMatch(/^md5:/);
    expect(first.appendedMessages.map((message) => message.id)).toEqual(
      second.appendedMessages.map((message) => message.id),
    );
  });

  it('does not append optional entries dropped by the shared budget', () => {
    const stablePrefix = buildOnDemandStablePrefix({ agentPrompt: 'agent prompt' });
    const protocol = buildOnDemandProtocol({
      budget: { fixedTokens: emptyFixedTokens, maxTokens: 15 },
      currentUserMessage: { content: 'current', role: 'user' },
      entries: [
        makeDynamicEntry({ key: 'high', relevance: 1, estimatedTokens: 10 }),
        makeDynamicEntry({ key: 'low', relevance: 0, estimatedTokens: 10 }),
      ],
      stablePrefix,
    });

    expect(protocol.budget.selected.map((entry) => entry.key)).toEqual(['high']);
    expect(protocol.appendedMessages).toHaveLength(1);
    expect(protocol.appendedMessages[0].metadata.entryKey).toBe('high');
  });

  it('renders every required dynamic kind as a post-user-message entry', () => {
    const stablePrefix = buildOnDemandStablePrefix({ agentPrompt: 'agent prompt' });
    const entries = ON_DEMAND_DYNAMIC_KINDS.map((kind) =>
      makeDynamicEntry({
        key: `kind-${kind}`,
        kind,
      }),
    );

    const protocol = buildOnDemandProtocol({
      budget: { fixedTokens: emptyFixedTokens, maxTokens: 1000 },
      currentUserMessage: { content: 'current', role: 'user' },
      entries,
      stablePrefix,
    });

    expect(new Set(protocol.appendedMessages.map((message) => message.metadata.kind))).toEqual(
      new Set(ON_DEMAND_DYNAMIC_KINDS),
    );
    expect(protocol.appendedMessages).toHaveLength(ON_DEMAND_DYNAMIC_KINDS.length);
  });
});
