import type { OnDemandContextCandidate, UIChatMessage } from '@lobechat/types';
import { ON_DEMAND_BOOTSTRAP_IDENTIFIERS, ON_DEMAND_PROTOCOL_VERSION } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { MessagesEngine } from '../../engine/messages/MessagesEngine';
import type { MessagesEngineParams } from '../../engine/messages/types';
import { hashContent } from '../canonical';
import { ON_DEMAND_PROTOCOL_CONTENT } from '../protocolBuilder';
import { buildOnDemandTraceMetadata } from '../traceMetadata';
import { processOnDemandMessages } from './OnDemandMessagesPipeline';

const AT = 1_700_000_000_000;
const SYSTEM_ROLE = '  User-authored Agent Prompt\n\tkeep every byte  ';

const message = (value: Partial<UIChatMessage>): UIChatMessage =>
  ({
    content: '',
    createdAt: AT,
    id: 'message',
    role: 'user',
    updatedAt: AT,
    ...value,
  }) as UIChatMessage;

const createParams = (overrides: Partial<MessagesEngineParams> = {}): MessagesEngineParams => ({
  contextMode: 'on-demand',
  enableSystemDate: true,
  historyCount: 1,
  inputTemplate: 'MUST NOT RUN: {{text}}',
  messages: [
    message({ content: 'first historical user message', id: 'u1', role: 'user' }),
    message({ content: 'historical assistant reply', id: 'a1', role: 'assistant' }),
    message({ content: '  current user {{username}}\nkeep exactly  ', id: 'u2', role: 'user' }),
  ],
  model: 'gpt-4',
  modelDisplayName: 'GPT-4',
  modelKnowledgeCutoff: '2024-06',
  provider: 'openai',
  systemRole: SYSTEM_ROLE,
  ...overrides,
});

const memory = {
  contexts: [{ description: 'private memory body', id: 'memory-context' }],
  experiences: [],
  preferences: [],
};

const retrievalCandidate = (input: {
  approval?: OnDemandContextCandidate['approval'];
  authority?: OnDemandContextCandidate['authority'];
  content: string;
  id: string;
  relevance?: number;
}): OnDemandContextCandidate => ({
  approval: input.approval ?? { state: 'approved' },
  authority: input.authority ?? 'memory',
  content: input.content,
  contentHash: hashContent(input.content),
  id: input.id,
  relevance: input.relevance ?? 1,
  scope: {
    ownerUserId: 'user-1',
    share: 'personal',
    shareGate: 'allowed',
  },
  source: { id: input.id, type: 'memory' },
});

describe('OnDemandMessagesPipeline', () => {
  it('builds only the raw prompt + protocol in system and appends cards after the user', async () => {
    const params = createParams({
      agentDocuments: [
        {
          content: 'full private agent document body',
          description: 'Selected setup notes',
          filename: 'setup.md',
          id: 'doc-1',
          policyLoad: 'always',
          title: 'Setup',
        },
      ],
      knowledge: {
        fileContents: [
          {
            content: 'full knowledge body',
            fileId: 'file-1',
            filename: 'setup.md',
          },
        ],
        knowledgeBases: [{ description: 'knowledge body', id: 'kb-1', name: 'Setup KB' }],
      },
      selectedSkills: [
        {
          content: 'full selected skill body',
          identifier: 'setup-skill',
          name: 'Setup Skill',
          resources: {
            'references/setup.md': {
              fileHash: 'reference-hash',
              size: 128,
            },
          },
          source: 'user',
        },
      ],
      skillsConfig: {
        enabledSkills: [
          {
            content: 'full activated skill body',
            description: 'Selected setup notes',
            identifier: 'setup-skill',
            name: 'Setup Skill',
          },
          {
            content: 'full non-selected skill body',
            description: 'Create charts from datasets',
            identifier: 'charts-skill',
            name: 'Charts Skill',
          },
        ],
      },
      toolsConfig: {
        manifests: [
          {
            api: [
              {
                description: 'Release payload schema',
                name: 'release',
                parameters: {
                  properties: { version: { type: 'string' } },
                  type: 'object',
                },
              },
            ],
            identifier: 'cold-release-tool',
            meta: { description: 'Selected release tool', title: 'Release' },
            systemRole: 'full cold tool manual',
          },
        ],
        tools: ['cold-release-tool'],
      },
    });

    const result = await processOnDemandMessages(params);
    const [system, ...conversationAndSuffix] = result.messages;

    expect(system).toEqual({
      content: `${SYSTEM_ROLE}\n\n${ON_DEMAND_PROTOCOL_CONTENT}`,
      role: 'system',
    });
    expect(system.content.slice(0, SYSTEM_ROLE.length)).toBe(SYSTEM_ROLE);
    expect(system.content).not.toContain('private memory body');
    expect(system.content).not.toContain('full selected skill body');
    expect(system.content).not.toContain('full activated skill body');
    expect(system.content).not.toContain('full non-selected skill body');
    expect(system.content).not.toContain('full private agent document body');
    expect(system.content).not.toContain('Current date:');

    expect(conversationAndSuffix.slice(0, params.messages.length)).toEqual(
      params.messages.map(({ content, role, ...rest }) => {
        const untyped = rest as Record<string, unknown>;
        return {
          content,
          role,
          ...(untyped.tool_call_id !== undefined && { tool_call_id: untyped.tool_call_id }),
          ...(untyped.tool_calls !== undefined && { tool_calls: untyped.tool_calls }),
        };
      }),
    );
    expect(result.messages[3].content).toBe(params.messages[2].content);

    const suffix = result.messages.slice(1 + params.messages.length);
    expect(suffix.length).toBeGreaterThan(0);
    expect(suffix.every((entry) => entry.role === 'user')).toBe(true);
    for (const entry of suffix) {
      expect(entry.content).not.toContain('full activated skill body');
      expect(entry.content).not.toContain('full non-selected skill body');
      expect(entry.content).not.toContain('full private agent document body');
      expect(entry.content).not.toContain('full knowledge body');
      expect(entry.content).not.toContain('full cold tool manual');
      expect(entry.content).not.toContain('Release payload schema');
      expect(entry.content).not.toContain('MUST NOT RUN');
    }
    expect(suffix.map((entry) => entry.content).join('\n')).toContain('full selected skill body');

    const included = result.metadata.dynamicEntries?.filter((entry) => entry.included) ?? [];
    expect(included.length).toBeGreaterThan(0);
    expect(
      included.every((entry) => entry.kind.endsWith('_card') || entry.kind === 'environment'),
    ).toBe(true);
    expect(result.metadata.dynamicEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          included: true,
          key: 'skill:setup-skill:card',
          priority: 20,
          required: true,
        }),
        expect.objectContaining({
          included: true,
          key: 'skill:setup-skill:content',
          priority: 15,
          provenance: expect.objectContaining({
            contentHash: expect.stringMatching(/^md5:/),
            sourceVersion: 'manual-selected',
          }),
          required: true,
        }),
        expect.objectContaining({
          included: true,
          key: 'skill:setup-skill:reference:references/setup.md',
          priority: 18,
          provenance: expect.objectContaining({
            referencePath: 'references/setup.md',
            sourceVersion: 'reference-hash',
          }),
          required: true,
        }),
        expect.objectContaining({
          dropReason: 'first_turn_body_deferred',
          included: false,
          key: 'skill:charts-skill:content',
        }),
      ]),
    );
    expect(result.metadata.stablePrefixHash).toMatch(/^md5:/);
    expect(result.metadata.rawSystemRoleHash).toBe(hashContent(SYSTEM_ROLE));
    expect(result.metadata.bootstrapToolIds).toEqual(ON_DEMAND_BOOTSTRAP_IDENTIFIERS);
    expect(result.metadata.onDemandContext?.budget).toMatchObject({
      availableDynamicTokens: expect.any(Number),
      dropped: expect.any(Array),
      maxTokens: expect.any(Number),
      selectedKeys: expect.arrayContaining(['skill:setup-skill:content']),
      status: 'within_budget',
      totalTokens: expect.any(Number),
    });
    const contextMetadata = result.metadata.onDemandContext!;
    expect(contextMetadata.messageSegments.map(({ index, source }) => ({ index, source }))).toEqual(
      [
        { index: 0, source: 'stable_system' },
        { index: 1, source: 'history' },
        { index: 2, source: 'history' },
        { index: 3, source: 'current_user' },
        ...contextMetadata.messageSegments.slice(4).map(({ index }) => ({
          index,
          source: 'dynamic_suffix' as const,
        })),
      ],
    );
    expect(contextMetadata.messageSegments[4]).toMatchObject({
      entryKey: expect.any(String),
      kind: expect.any(String),
      sourceId: expect.any(String),
      sourceType: expect.any(String),
    });
    expect(contextMetadata.bootstrapTools).toHaveLength(3);
    expect(contextMetadata.bootstrapTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          apiNames: ['activateTools'],
          identifier: 'lobe-activator',
          manifestHash: expect.stringMatching(/^md5:/),
        }),
      ]),
    );
    expect(contextMetadata.tokens).toMatchObject({
      bootstrapTools: expect.any(Number),
      budgetTotal: contextMetadata.budget.totalTokens,
      dynamic: expect.any(Number),
      fixed: contextMetadata.budget.fixedTokens,
      max: contextMetadata.budget.maxTokens,
      messageTotal: contextMetadata.messageSegments.reduce(
        (total, segment) => total + segment.estimatedTokens,
        0,
      ),
      stableSystem: contextMetadata.messageSegments[0].estimatedTokens,
    });
    const traceMetadata = buildOnDemandTraceMetadata({
      activatedToolBundles: [
        {
          activatedAtStep: 1,
          capabilityHash: 'md5:capability',
          capabilityVersion: '1.0.0',
          identifier: 'release-tool',
          manifestHash: 'md5:manifest',
          source: 'discovery',
        },
      ],
      context: contextMetadata,
      rawSystemRole: SYSTEM_ROLE,
    });
    expect(traceMetadata.rawSystemRole).toBe(SYSTEM_ROLE);
    expect(traceMetadata.rawSystemRoleHash).toBe(hashContent(SYSTEM_ROLE));
    expect(traceMetadata.activatedToolBundles[0].capabilityHash).toBe('md5:capability');
    expect(JSON.stringify(traceMetadata.messageSegments)).not.toContain(SYSTEM_ROLE);
    expect(result.metadata.protocolVersion).toBe(ON_DEMAND_PROTOCOL_VERSION);
  });

  it('auto-loads a manually selected skill without a second activateSkill call', async () => {
    const params = createParams({
      messages: [message({ content: 'use the selected deploy skill', id: 'u1', role: 'user' })],
      selectedSkills: [
        {
          content: 'manual deploy body',
          identifier: 'deploy',
          name: 'Deploy',
          resources: {
            'references/checklist.md': {
              fileHash: 'checklist-hash',
              size: 32,
            },
          },
        },
      ],
    });

    const result = await processOnDemandMessages(params);
    const suffix = result.messages.slice(2);

    expect(suffix.map((entry) => entry.content).join('\n')).toContain('manual deploy body');
    expect(suffix.map((entry) => entry.content).join('\n')).toContain('references/checklist.md');
    expect(
      result.messages.some((entry) => entry.content?.toString().includes('activateSkill')),
    ).toBe(false);
    expect(result.metadata.dynamicEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ included: true, key: 'skill:deploy:content', required: true }),
        expect.objectContaining({
          included: true,
          key: 'skill:deploy:reference:references/checklist.md',
          required: true,
        }),
      ]),
    );
  });

  it('keeps only budgeted discovery cards and protected manual activation entries', async () => {
    const params = createParams({
      messages: [message({ content: 'deploy release charts', id: 'u1', role: 'user' })],
      onDemand: { maxTokens: 0 },
      selectedSkills: [
        {
          content: 'selected deploy body',
          identifier: 'deploy',
          name: 'Deploy',
        },
      ],
      skillsConfig: {
        enabledSkills: [
          {
            content: 'chart body',
            description: 'deploy release charts',
            identifier: 'charts',
            name: 'Charts',
          },
        ],
      },
    });

    const result = await processOnDemandMessages(params);
    const entries = result.metadata.dynamicEntries ?? [];
    const includedSkillEntries = entries.filter(
      (entry) => entry.included && entry.kind === 'skill_card',
    );

    expect(includedSkillEntries.map((entry) => entry.key)).toEqual(
      expect.arrayContaining(['skill:deploy:card', 'skill:deploy:content']),
    );
    expect(includedSkillEntries.every((entry) => entry.required)).toBe(true);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dropReason: 'budget_exceeded',
          included: false,
          key: 'skill:charts:card',
        }),
        expect.objectContaining({
          dropReason: 'first_turn_body_deferred',
          included: false,
          key: 'skill:charts:content',
        }),
      ]),
    );
  });

  it('emits a relevant document card while keeping the document body behind readDocument', async () => {
    const params = createParams({
      agentDocuments: [
        {
          content: 'full private setup document body',
          description: 'Setup notes',
          filename: 'setup.md',
          id: 'doc-1',
          policyLoad: 'always',
          title: 'Setup notes',
          updatedAt: '2026-01-02T03:04:05.000Z',
        },
      ],
      messages: [message({ content: 'open the setup notes', id: 'u1', role: 'user' })],
    });

    const result = await processOnDemandMessages(params);
    const suffix = result.messages
      .slice(2)
      .map((entry) => entry.content)
      .join('\n');

    expect(suffix).toContain('<document_card');
    expect(suffix).toContain('setup.md');
    expect(suffix).not.toContain('full private setup document body');
    expect(result.metadata.dynamicEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          included: true,
          key: 'document:doc-1:card',
          kind: 'document_card',
          provenance: expect.objectContaining({
            sourceVersion: '2026-01-02T03:04:05.000Z',
          }),
        }),
        expect.objectContaining({
          dropReason: 'first_turn_body_deferred',
          included: false,
          key: 'document:doc-1:content',
        }),
      ]),
    );
  });

  it('keeps long user and history content byte-for-byte without truncation or templating', async () => {
    const longHistory = `history-start ${'h'.repeat(12_000)} history-end`;
    const longCurrent = `current-start {{username}} ${'u'.repeat(20_000)} current-end`;
    const params = createParams({
      messages: [
        message({ content: longHistory, id: 'u1', role: 'user' }),
        message({ content: 'assistant', id: 'a1', role: 'assistant' }),
        message({ content: longCurrent, id: 'u2', role: 'user' }),
      ],
    });

    const result = await new MessagesEngine(params).process();

    expect(result.messages[1].content).toBe(longHistory);
    expect(result.messages[3].content).toBe(longCurrent);
    expect(result.messages[3].content).toContain('{{username}}');
    expect(result.messages[3].content).not.toContain('MUST NOT RUN');
    expect(result.messages[1].content.length).toBe(longHistory.length);
    expect(result.messages[3].content.length).toBe(longCurrent.length);
  });

  it('keeps the complete activation manual in the tool message and out of system', async () => {
    const manual = [
      '<tool_manual identifier="cold-release-tool">',
      'Full native release instructions.',
      JSON.stringify({ parameters: { version: { type: 'string' } } }, null, 2),
      '</tool_manual>',
    ].join('\n');
    const params = createParams({
      messages: [
        message({ content: 'history user', id: 'u1', role: 'user' }),
        message({
          content: '',
          id: 'a1',
          role: 'assistant',
          tool_calls: [
            {
              function: {
                arguments: '{"identifiers":["cold-release-tool"]}',
                name: 'lobe-activator____activateTools',
              },
              id: 'call-1',
              type: 'function',
            },
          ],
        } as any),
        message({
          content: manual,
          id: 't1',
          role: 'tool',
          tool_call_id: 'call-1',
        } as any),
        message({ content: 'current user', id: 'u2', role: 'user' }),
      ],
    });

    const result = await processOnDemandMessages(params);

    expect(result.messages[0].content).toBe(`${SYSTEM_ROLE}\n\n${ON_DEMAND_PROTOCOL_CONTENT}`);
    expect(result.messages[0].content).not.toContain(manual);
    expect(result.messages.find((entry) => entry.role === 'tool')?.content).toBe(manual);
    expect(result.messages[4].content).toBe('current user');
  });

  it('flattens a completed activation group into native tool calls before the next step', async () => {
    const manual = '<tool_manual identifier="lobe-agent">full activation manual</tool_manual>';
    const params = createParams({
      messages: [
        message({ content: 'activate a tool', id: 'u1', role: 'user' }),
        message({
          children: [
            {
              content: '',
              id: 'a1',
              tools: [
                {
                  apiName: 'activateTools',
                  arguments: '{"identifiers":["lobe-agent"]}',
                  id: 'call-1',
                  identifier: 'lobe-activator',
                  result: {
                    content: manual,
                    id: 't1',
                  },
                  type: 'builtin',
                },
              ],
            },
          ],
          content: '',
          id: 'group-1',
          role: 'assistantGroup',
        } as any),
        message({ content: 'current user', id: 'u2', role: 'user' }),
      ],
    });

    const result = await new MessagesEngine(params).process();

    expect(result.messages[2]).toMatchObject({
      content: '',
      role: 'assistant',
      tool_calls: [
        {
          function: {
            arguments: '{"identifiers":["lobe-agent"]}',
            name: 'lobe-activator____activateTools',
          },
          id: 'call-1',
          type: 'function',
        },
      ],
    });
    expect(result.messages[3]).toMatchObject({
      content: manual,
      name: 'lobe-activator____activateTools',
      role: 'tool',
      tool_call_id: 'call-1',
    });
    expect(result.messages[4].content).toBe('current user');
    expect(result.messages[0].content).not.toContain(manual);
  });

  it('appends relevant memory and expertise only after the unchanged current user message', async () => {
    const params = createParams({
      onDemand: {
        retrieval: {
          candidates: [
            retrievalCandidate({
              content: 'Use the deployment rollback checklist.',
              id: 'memory-rollback',
            }),
            retrievalCandidate({
              authority: 'approved_experience',
              content: 'Deployment rollback requires two reviewers.',
              id: 'expertise-rollback',
            }),
          ],
          mode: 'vector',
        },
      },
    });

    const result = await processOnDemandMessages(params);

    expect(result.messages[0]).toEqual({
      content: `${SYSTEM_ROLE}\n\n${ON_DEMAND_PROTOCOL_CONTENT}`,
      role: 'system',
    });
    expect(result.messages[3].content).toBe('  current user {{username}}\nkeep exactly  ');
    const appended = result.messages.slice(1 + params.messages.length);
    const retrievalEntries = result.metadata.dynamicEntries?.filter((entry) =>
      entry.key.startsWith('retrieval:'),
    );
    expect(retrievalEntries?.filter((entry) => entry.included)).toHaveLength(2);
    expect(appended.map((entry) => entry.content)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Use the deployment rollback checklist.'),
        expect.stringContaining('Deployment rollback requires two reviewers.'),
      ]),
    );
    expect(appended.map((entry) => entry.content).join('\n')).toContain('deployment rollback');
    expect(result.metadata.onDemandContext?.retrieval).toMatchObject({
      includedCount: 2,
      hitCount: 2,
      mode: 'vector',
    });
  });

  it('adds no empty dynamic block when retrieval has no hits', async () => {
    const params = createParams();
    const result = await processOnDemandMessages(params);
    const appended = result.messages.slice(1 + params.messages.length);

    expect(
      appended.filter((entry) =>
        /<user_memory|<retrieved_memory|<user_constraint|<agent_suggestion/.test(
          String(entry.content),
        ),
      ),
    ).toEqual([]);
    expect(result.metadata.onDemandContext?.retrieval).toMatchObject({
      degradedCount: 0,
      hitCount: 0,
      includedCount: 0,
      mode: 'none',
    });
    expect(
      result.metadata.dynamicEntries?.filter(
        (entry) =>
          entry.kind === 'memory' ||
          entry.kind === 'preference' ||
          entry.kind === 'approved_expertise' ||
          entry.kind === 'unapproved_suggestion' ||
          entry.kind === 'explicit_constraint',
      ),
    ).toEqual([]);
  });

  it('keeps explicit constraints while degrading lower-priority suggestions first', async () => {
    const params = createParams({
      onDemand: {
        maxTokens: 0,
        retrieval: {
          candidates: [
            retrievalCandidate({
              authority: 'explicit_constraint',
              content: 'Deployment must keep rollback enabled.',
              id: 'explicit',
            }),
            retrievalCandidate({
              approval: { state: 'pending' },
              authority: 'approved_experience',
              content: `Deployment suggestion ${'x'.repeat(600)}`,
              id: 'suggestion',
            }),
          ],
          mode: 'lexical_fallback',
        },
      },
    });

    const result = await processOnDemandMessages(params);
    const appended = result.messages.slice(1 + params.messages.length);

    expect(appended).toHaveLength(1);
    expect(appended[0].content).toContain('<user_constraint');
    expect(appended[0].content).toContain('rollback enabled');
    expect(appended[0].content).not.toContain('Deployment suggestion');
    expect(result.metadata.onDemandContext?.retrieval).toMatchObject({
      degradedCount: 1,
      hitCount: 2,
      includedCount: 1,
    });
  });

  it('keeps selected tool contracts verbatim under one shared budget', async () => {
    const firstContract = `<tool_contract identifier="release-tool">\n${'release schema '.repeat(
      120,
    )}\n</tool_contract>`;
    const secondContract = `<tool_contract identifier="rollback-tool">\n${'rollback schema '.repeat(
      100,
    )}\n</tool_contract>`;
    const activeManifest = (identifier: string) => ({
      api: [
        {
          description: `${identifier} API`,
          name: 'execute',
          parameters: { properties: { value: { type: 'string' } }, type: 'object' },
        },
      ],
      identifier,
      meta: { title: identifier },
      systemRole: `${identifier} native contract`,
    });
    const params = createParams({
      messages: [
        message({ content: 'release and rollback this deployment', id: 'u1', role: 'user' }),
      ],
      onDemand: {
        budget: { dynamicTokens: 5_000, reserveTokens: 0, totalTokens: 5_000 },
      },
      selectedTools: [
        { content: firstContract, identifier: 'release-tool', name: 'Release' },
        { content: secondContract, identifier: 'rollback-tool', name: 'Rollback' },
      ],
      toolsConfig: {
        manifests: [
          activeManifest('release-tool'),
          activeManifest('rollback-tool'),
          activeManifest('audit-tool'),
        ],
        tools: ['release-tool', 'rollback-tool', 'audit-tool'],
      },
    });

    const result = await processOnDemandMessages(params);
    const appended = result.messages.slice(1 + params.messages.length);
    const appendedText = appended.map((entry) => entry.content).join('\n');
    const budget = result.metadata.onDemandContext?.budget;

    expect(result.messages[1].content).toBe('release and rollback this deployment');
    expect(appendedText).toContain(firstContract);
    expect(appendedText).toContain(secondContract);
    expect(budget?.fixedBreakdown.activeToolContracts).toBeGreaterThan(0);
    expect(budget?.estimator).toEqual({
      id: 'tokenx',
      model: 'gpt-4',
      provider: 'openai',
    });
    expect(budget?.selectedKeys).toEqual(
      expect.arrayContaining(['tool:release-tool:manual', 'tool:rollback-tool:manual']),
    );
    expect(budget?.totalTokens).toBeLessThanOrEqual(5_000);
    expect(
      result.metadata.dynamicEntries?.filter((entry) => entry.kind === 'tool_contract'),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'tool:release-tool:manual', required: true }),
        expect.objectContaining({ key: 'tool:rollback-tool:manual', required: true }),
      ]),
    );
    expect(JSON.stringify(budget)).not.toContain('release schema');
    expect(JSON.stringify(budget)).not.toContain('rollback schema');
  });

  it('degrades a low-relevance retrieved memory before an explicit constraint', async () => {
    const params = createParams({
      messages: [message({ content: 'deploy with rollback', id: 'u1', role: 'user' })],
      onDemand: {
        budget: { dynamicTokens: 1_400, reserveTokens: 0, totalTokens: 1_400 },
        retrieval: {
          candidates: [
            retrievalCandidate({
              authority: 'explicit_constraint',
              content: 'Deployment must retain the rollback gate.',
              id: 'constraint',
              relevance: 1,
            }),
            retrievalCandidate({
              content: `Low relevance deployment note ${'x'.repeat(2_000)}`,
              id: 'low-memory',
              relevance: 0.2,
            }),
          ],
          mode: 'vector',
        },
      },
    });

    const result = await processOnDemandMessages(params);
    const appended = result.messages.slice(1 + params.messages.length);
    const lowMemory = result.metadata.dynamicEntries?.find(
      (entry) => entry.key === 'retrieval:memory:low-memory',
    );

    expect(appended.map((entry) => entry.content).join('\n')).toContain(
      'Deployment must retain the rollback gate.',
    );
    expect(lowMemory).toMatchObject({
      decision: 'degraded',
      included: true,
      key: 'retrieval:memory:low-memory',
    });
    expect(lowMemory?.degradation).toMatchObject({
      reason: 'low_relevance',
      originalContentHash: expect.stringMatching(/^md5:/),
      recoveryRef: expect.stringContaining('memory:low-memory'),
    });
    expect(appended.map((entry) => entry.content).join('\n')).toContain('<on_demand_summary');
    expect(result.metadata.onDemandContext?.budget.totalTokens).toBeLessThanOrEqual(1_400);
    expect(result.metadata.onDemandContext?.retrieval).toMatchObject({
      degradedCount: 1,
      includedCount: 2,
    });
  });

  it('omits unrelated skill and document cards before protected context under pressure', async () => {
    const params = createParams({
      agentDocuments: [
        {
          content: `Unrelated cooking notes ${'x'.repeat(2_000)}`,
          filename: 'cooking.md',
          id: 'cooking-doc',
          title: 'Cooking',
        },
      ],
      messages: [message({ content: 'deploy the release safely', id: 'u1', role: 'user' })],
      onDemand: {
        budget: { dynamicTokens: 1_400, reserveTokens: 0, totalTokens: 1_400 },
      },
      selectedSkills: [
        {
          content: 'Release deployment must pass health checks.',
          identifier: 'release-skill',
          name: 'Release',
        },
      ],
      skillsConfig: {
        enabledSkills: [
          {
            content: `Unrelated recipe ${'x'.repeat(2_000)}`,
            description: 'Cooking instructions for dinner',
            identifier: 'cooking-skill',
            name: 'Cooking',
          },
        ],
      },
    });

    const result = await processOnDemandMessages(params);
    const appendedText = result.messages
      .slice(1 + params.messages.length)
      .map((entry) => entry.content)
      .join('\n');

    expect(appendedText).toContain('Release deployment must pass health checks.');
    expect(appendedText).not.toContain('Unrelated recipe');
    expect(appendedText).not.toContain('Unrelated cooking notes');
    expect(result.metadata.dynamicEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dropReason: 'low_relevance',
          included: false,
          key: 'skill:cooking-skill:card',
        }),
        expect.objectContaining({
          dropReason: 'low_relevance',
          included: false,
          key: 'document:cooking-doc:card',
        }),
      ]),
    );
    expect(result.metadata.onDemandContext?.budget.totalTokens).toBeLessThanOrEqual(1_400);
  });

  it('keeps a large shared retrieval batch within budget without exposing bodies in metadata', async () => {
    const privateBodyMarker = 'PRIVATE_MEMORY_BODY';
    const candidates = Array.from({ length: 40 }, (_, index) =>
      retrievalCandidate({
        content: `${privateBodyMarker} ${index} ${'deployment memory '.repeat(80)}`,
        id: `memory-${String(index).padStart(2, '0')}`,
        relevance: 0.9,
      }),
    );
    const params = createParams({
      messages: [
        message({ content: '  keep this deployment request exact  ', id: 'u1', role: 'user' }),
      ],
      onDemand: {
        budget: { dynamicTokens: 1_600, reserveTokens: 0, totalTokens: 1_600 },
        retrieval: { candidates, mode: 'vector' },
      },
    });

    const result = await processOnDemandMessages(params);
    const budget = result.metadata.onDemandContext?.budget;
    const retrievalEntries = result.metadata.dynamicEntries?.filter((entry) =>
      entry.key.startsWith('retrieval:'),
    );

    expect(result.messages[1].content).toBe('  keep this deployment request exact  ');
    expect(budget?.totalTokens).toBeLessThanOrEqual(1_600);
    expect(retrievalEntries).toHaveLength(40);
    expect(result.metadata.onDemandContext?.retrieval).toMatchObject({
      degradedCount: expect.any(Number),
      hitCount: 40,
      includedCount: expect.any(Number),
    });
    expect(
      retrievalEntries?.some((entry) => entry.decision === 'omitted') ||
        retrievalEntries?.some((entry) => entry.decision === 'degraded'),
    ).toBe(true);
    expect(JSON.stringify(result.metadata.onDemandContext)).not.toContain(privateBodyMarker);
    expect(JSON.stringify(budget)).not.toContain('deployment memory deployment memory');
  });

  it('leaves legacy assembly on the existing whole-memory injector', async () => {
    const result = await new MessagesEngine({
      ...createParams(),
      contextMode: undefined,
      userMemory: {
        enabled: true,
        memories: {
          contexts: [],
          experiences: [],
          preferences: [
            {
              conclusionDirectives: 'Legacy injector keeps this whole preference.',
              id: 'legacy-preference',
            },
          ],
        },
      },
    }).process();

    expect(result.metadata).toMatchObject({ userMemoryInjected: true });
    expect(result.metadata.onDemandContext).toBeUndefined();
    expect(
      result.messages.some((message) => message.content?.toString().includes('Legacy injector')),
    ).toBe(true);
  });

  it('keeps the stable-prefix hash independent of every dynamic input', async () => {
    const first = await processOnDemandMessages(
      createParams({
        contextMode: 'on-demand',
        userMemory: { enabled: true, memories: memory },
      }),
    );
    const second = await processOnDemandMessages(
      createParams({
        agentDocuments: [
          {
            content: 'different document body',
            filename: 'different.md',
            id: 'doc-different',
          },
        ],
        contextMode: 'on-demand',
        knowledge: {
          fileContents: [
            { content: 'different knowledge', fileId: 'file-different', filename: 'different.md' },
          ],
        },
        skillsConfig: {
          enabledSkills: [
            {
              description: 'different skill',
              identifier: 'different-skill',
              name: 'Different Skill',
            },
          ],
        },
        toolsConfig: {
          manifests: [
            {
              api: [],
              identifier: 'different-tool',
              meta: { title: 'Different Tool' },
            },
          ],
        },
      }),
    );

    expect(second.metadata.stablePrefixHash).toBe(first.metadata.stablePrefixHash);
    expect(second.metadata.rawSystemRoleHash).toBe(first.metadata.rawSystemRoleHash);
    expect(second.metadata.dynamicEntries).not.toEqual(first.metadata.dynamicEntries);
  });
});
