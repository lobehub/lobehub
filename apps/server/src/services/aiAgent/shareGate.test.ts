import { AcceptanceEvidenceIdentifier } from '@lobechat/builtin-tool-acceptance-evidence';
import { LobeActivatorIdentifier } from '@lobechat/builtin-tool-activator';
import {
  AgentDocumentsApiName,
  AgentDocumentsIdentifier,
  AgentDocumentsManifest,
} from '@lobechat/builtin-tool-agent-documents';
import {
  AgentManagementApiName,
  AgentManagementIdentifier,
  AgentManagementManifest,
} from '@lobechat/builtin-tool-agent-management';
import {
  AGENT_SIGNAL_REVIEW_IDENTIFIER,
  AGENT_SIGNAL_REVIEW_TOOL_API_NAMES,
  AGENT_SIGNAL_SKILL_MANAGEMENT_IDENTIFIER,
  AGENT_SIGNAL_SKILL_MANAGEMENT_TOOL_API_NAMES,
  agentSignalSkillManagementManifest,
} from '@lobechat/builtin-tool-agent-signal';
import { BriefApiName, BriefIdentifier } from '@lobechat/builtin-tool-brief';
import { CalculatorIdentifier } from '@lobechat/builtin-tool-calculator';
import { ImageGenerationIdentifier } from '@lobechat/builtin-tool-image-generation';
import {
  KnowledgeBaseApiName,
  KnowledgeBaseIdentifier,
  KnowledgeBaseManifest,
} from '@lobechat/builtin-tool-knowledge-base';
import { LobeAgentIdentifier, LobeAgentManifest } from '@lobechat/builtin-tool-lobe-agent';
import { MemoryApiName, MemoryIdentifier, MemoryManifest } from '@lobechat/builtin-tool-memory';
import { DocumentApiName, PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
import {
  SkillMaintainerApiName,
  SkillMaintainerIdentifier,
  SkillMaintainerManifest,
} from '@lobechat/builtin-tool-skill-maintainer';
import { TaskApiName, TaskIdentifier, TaskManifest } from '@lobechat/builtin-tool-task';
import { TopicReferenceIdentifier } from '@lobechat/builtin-tool-topic-reference';
import { UserInteractionIdentifier } from '@lobechat/builtin-tool-user-interaction';
import { VerifyToolIdentifier } from '@lobechat/builtin-tool-verify';
import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { builtinTools } from '@lobechat/builtin-tools';
import { describe, expect, it } from 'vitest';

import type { AgentShareGate, ShareGateToolSet } from './shareGate';
import {
  applyShareGateToAgentConfig,
  applyShareGateToToolSet,
  filterPluginsByShareGate,
  isShareBlockedDataToolCall,
} from './shareGate';

const buildGate = (config: Partial<AgentShareGate['shareConfig']> = {}): AgentShareGate => ({
  agentId: 'agent-1',
  shareConfig: {
    maxTopicsPerVisitor: 5,
    maxTurnsPerTopic: 20,
    ...config,
  },
  visitorUserId: 'visitor-1',
});

describe('filterPluginsByShareGate', () => {
  it('keeps only whitelisted plugin ids', () => {
    const gate = buildGate({ enabledToolIds: ['web-search', 'mcp-github'] });

    expect(filterPluginsByShareGate(['web-search', 'local-system', 'mcp-github'], gate)).toEqual([
      'web-search',
      'mcp-github',
    ]);
  });

  it('exposes no tools when the whitelist is missing or empty', () => {
    expect(filterPluginsByShareGate(['web-search'], buildGate())).toEqual([]);
    expect(filterPluginsByShareGate(['web-search'], buildGate({ enabledToolIds: [] }))).toEqual([]);
  });
});

describe('applyShareGateToAgentConfig', () => {
  it('strips files and knowledge bases unless explicitly readable', () => {
    const agentConfig = {
      files: [{ enabled: true, id: 'f1' }],
      knowledgeBases: [{ enabled: true, id: 'kb1' }],
    };

    applyShareGateToAgentConfig(agentConfig, buildGate());

    expect(agentConfig.files).toEqual([]);
    expect(agentConfig.knowledgeBases).toEqual([]);
  });

  it('keeps surfaces granted read access', () => {
    const agentConfig = {
      files: [{ enabled: true, id: 'f1' }],
      knowledgeBases: [{ enabled: true, id: 'kb1' }],
    };

    applyShareGateToAgentConfig(
      agentConfig,
      buildGate({
        filePermissionConfig: { agentFiles: 'read', knowledgeBase: 'read', uploadAllowed: false },
      }),
    );

    expect(agentConfig.files).toHaveLength(1);
    expect(agentConfig.knowledgeBases).toHaveLength(1);
  });

  it('applies surfaces independently', () => {
    const agentConfig = {
      files: [{ enabled: true, id: 'f1' }],
      knowledgeBases: [{ enabled: true, id: 'kb1' }],
    };

    applyShareGateToAgentConfig(
      agentConfig,
      buildGate({
        filePermissionConfig: { agentFiles: 'read', knowledgeBase: 'none', uploadAllowed: false },
      }),
    );

    expect(agentConfig.files).toHaveLength(1);
    expect(agentConfig.knowledgeBases).toEqual([]);
  });
});

describe('applyShareGateToToolSet', () => {
  // Simulates the fully-assembled operation tool set right before it's
  // persisted as `toolSet` — i.e. AFTER LobeHub Skill / Composio / real-MCP
  // connector manifests and the always-on builtin defaults have all been
  // merged in by `execAgent`, unconditionally, from the creator's own config.
  const buildToolSet = (): ShareGateToolSet => ({
    activatableToolIds: ['web-search', 'composio-github', 'lobe-agent'],
    enabledToolIds: ['web-search', 'lobe-activator'],
    executorMap: { 'composio-github': 'client' as any },
    manifestMap: {
      'composio-github': { api: [], identifier: 'composio-github', type: 'default' } as any,
      'lobe-activator': { api: [], identifier: 'lobe-activator', type: 'default' } as any,
      'web-search': { api: [], identifier: 'web-search', type: 'default' } as any,
    },
    sourceMap: { 'composio-github': 'composio', 'web-search': 'builtin' } as any,
    tools: [
      { function: { name: 'web-search____search' }, type: 'function' },
      { function: { name: 'composio-github____createIssue' }, type: 'function' },
    ],
  });

  it('collapses the tool set to nothing when the whitelist is missing or empty', () => {
    const gate = buildGate();
    const toolSet = buildToolSet();

    applyShareGateToToolSet(toolSet, gate);

    expect(toolSet.enabledToolIds).toEqual([]);
    expect(toolSet.activatableToolIds).toEqual([]);
    expect(toolSet.manifestMap).toEqual({});
    expect(toolSet.sourceMap).toEqual({});
    expect(toolSet.executorMap).toEqual({});
    expect(toolSet.tools).toEqual([]);
  });

  it('keeps only whitelisted identifiers across every surface — including the creator-connected Composio/discovery entries the initial plugin filter never touched', () => {
    const gate = buildGate({ enabledToolIds: ['web-search'] });
    const toolSet = buildToolSet();

    applyShareGateToToolSet(toolSet, gate);

    // `composio-github` and `lobe-activator` were never in shareConfig.enabledToolIds
    // (only the plugin-id filter upstream ever saw `web-search`), yet they were
    // still present in manifestMap/activatableToolIds — this is the discovery
    // surface `lobe-activator` and `ToolExecutionService` would otherwise use.
    expect(toolSet.enabledToolIds).toEqual(['web-search']);
    expect(toolSet.activatableToolIds).toEqual(['web-search']);
    expect(Object.keys(toolSet.manifestMap)).toEqual(['web-search']);
    expect(Object.keys(toolSet.sourceMap)).toEqual(['web-search']);
    expect(toolSet.executorMap).toEqual({});
    expect(toolSet.tools).toEqual([
      { function: { name: 'web-search____search' }, type: 'function' },
    ]);
  });

  it('mutates the caller-owned arrays/objects in place (no reassignment required)', () => {
    const gate = buildGate({ enabledToolIds: ['web-search'] });
    const toolSet = buildToolSet();
    const enabledToolIdsRef = toolSet.enabledToolIds;
    const manifestMapRef = toolSet.manifestMap;

    applyShareGateToToolSet(toolSet, gate);

    expect(toolSet.enabledToolIds).toBe(enabledToolIdsRef);
    expect(toolSet.manifestMap).toBe(manifestMapRef);
  });

  it('leaves a `tools: undefined` set untouched', () => {
    const gate = buildGate({ enabledToolIds: ['web-search'] });
    const toolSet = { ...buildToolSet(), tools: undefined };

    expect(() => applyShareGateToToolSet(toolSet, gate)).not.toThrow();
    expect(toolSet.tools).toBeUndefined();
  });

  it('strips sub-agent dispatch API (callSubAgent) from lobe-agent even when explicitly whitelisted', () => {
    // Sub-agent dispatch is not available in shared visitor runs, regardless
    // of whether the manifest passed to `applyShareGateToToolSet` was already
    // context-aware trimmed or not — this reproduces the untrimmed shape by
    // using the REAL exported builtin manifest (not a hand-written fixture),
    // so the regression also catches a future edit to the systemRole that
    // reintroduces a callSubAgent reference. `lobe-agent`'s non-dispatch APIs
    // (createPlan, etc.) stay available — they are genuinely self-scoped to
    // the current agent, unlike `lobe-agent-management` (see the dedicated
    // "lobe-agent-management is fully blocked" suite below).
    const gate = buildGate({ enabledToolIds: ['lobe-agent'] });
    const toolSet: ShareGateToolSet = {
      activatableToolIds: ['lobe-agent'],
      enabledToolIds: ['lobe-agent'],
      executorMap: {},
      manifestMap: {
        'lobe-agent': LobeAgentManifest,
      },
      sourceMap: {},
      tools: [
        { function: { name: 'lobe-agent____callSubAgent' }, type: 'function' },
        { function: { name: 'lobe-agent____createPlan' }, type: 'function' },
      ],
    };

    applyShareGateToToolSet(toolSet, gate);

    expect(Object.keys(toolSet.manifestMap)).toEqual(['lobe-agent']);
    const lobeAgentApiNames = toolSet.manifestMap['lobe-agent'].api.map((api) => api.name);
    expect(lobeAgentApiNames).not.toContain('callSubAgent');
    expect(lobeAgentApiNames).toContain('createPlan');
    expect(toolSet.tools).toEqual([
      { function: { name: 'lobe-agent____createPlan' }, type: 'function' },
    ]);

    // ...and the systemRole no longer instructs the model to call the
    // dispatch tool (the exact leak this test guards against: a stale
    // systemRole prompting a call to a tool that was just removed) —
    // including semantic phrasings that suggest dispatching without naming
    // the API.
    expect(toolSet.manifestMap['lobe-agent'].systemRole).not.toMatch(/callSubAgent/);
  });

  describe('lobe-agent-management is fully blocked for share visitors', () => {
    // Every API on `lobe-agent-management` — not just `callAgent` — operates
    // against the CREATOR's private agent collection with a visitor-
    // suppliable `agentId` argument that is never checked against the shared
    // agent itself (`searchAgent` enumerates the creator's whole workspace,
    // `getAgentDetail` returns any creator-owned agent's config/system
    // prompt, `createAgent`/`updateAgent`/`updatePrompt`/`duplicateAgent`/
    // `installPlugin` mutate the creator's collection — see
    // `agentManagementRuntime`). This reproduces the full untrimmed manifest
    // (as if it had been whitelisted and NOT already trimmed by
    // `resolveAgentManagementManifest`) to prove the identifier-level strip
    // in `applyShareGateToToolSet` is unconditional, independent of that
    // upstream context-aware path.
    const buildManagementToolSet = (): ShareGateToolSet => ({
      activatableToolIds: [AgentManagementIdentifier],
      enabledToolIds: [AgentManagementIdentifier],
      executorMap: { [AgentManagementIdentifier]: 'server' as any },
      manifestMap: { [AgentManagementIdentifier]: AgentManagementManifest },
      sourceMap: { [AgentManagementIdentifier]: 'builtin' } as any,
      tools: AgentManagementManifest.api.map((api) => ({
        function: { name: `${AgentManagementIdentifier}____${api.name}` },
        type: 'function',
      })),
    });

    it('removes the identifier entirely from every surface, even when explicitly whitelisted', () => {
      const gate = buildGate({ enabledToolIds: [AgentManagementIdentifier] });
      const toolSet = buildManagementToolSet();

      applyShareGateToToolSet(toolSet, gate);

      expect(toolSet.manifestMap[AgentManagementIdentifier]).toBeUndefined();
      expect(toolSet.sourceMap[AgentManagementIdentifier]).toBeUndefined();
      expect(toolSet.executorMap[AgentManagementIdentifier]).toBeUndefined();
      expect(toolSet.enabledToolIds).not.toContain(AgentManagementIdentifier);
      expect(toolSet.activatableToolIds).not.toContain(AgentManagementIdentifier);
      expect(toolSet.tools).toEqual([]);
    });
  });

  describe('lobe-task is fully blocked for share visitors', () => {
    // Tasks are a creator/workspace-level tracker, not a per-conversation
    // resource: `listTasks` deliberately supports `scope: 'allAgents'`
    // (enumerating every agent's tasks), and every single-task API
    // (`editTask`, `deleteTask`, `viewTask`, comments, schedule/verify
    // config, `runTask`) resolves a model-supplied `identifier`/`commentId`
    // through `TaskModel`/`taskRouter`, scoped only by the creator's
    // `userId`/`workspaceId` — never by which topic created or is currently
    // working the task (see `apps/server/src/services/toolExecution/
    // serverRuntimes/task.ts`). There is no membership relation (unlike
    // `lobe-agent-plan`'s topic-document association) to scope this to "only
    // tasks from this visitor's topic," so the whole identifier is removed.
    // Reproduces the real exported manifest, as if it had been whitelisted.
    const buildTaskToolSet = (): ShareGateToolSet => ({
      activatableToolIds: [TaskIdentifier],
      enabledToolIds: [TaskIdentifier],
      executorMap: { [TaskIdentifier]: 'server' as any },
      manifestMap: { [TaskIdentifier]: TaskManifest },
      sourceMap: { [TaskIdentifier]: 'builtin' } as any,
      tools: TaskManifest.api.map((api) => ({
        function: { name: `${TaskIdentifier}____${api.name}` },
        type: 'function',
      })),
    });

    it('removes the identifier entirely from every surface, even when explicitly whitelisted', () => {
      const gate = buildGate({ enabledToolIds: [TaskIdentifier] });
      const toolSet = buildTaskToolSet();

      applyShareGateToToolSet(toolSet, gate);

      expect(toolSet.manifestMap[TaskIdentifier]).toBeUndefined();
      expect(toolSet.sourceMap[TaskIdentifier]).toBeUndefined();
      expect(toolSet.executorMap[TaskIdentifier]).toBeUndefined();
      expect(toolSet.enabledToolIds).not.toContain(TaskIdentifier);
      expect(toolSet.activatableToolIds).not.toContain(TaskIdentifier);
      expect(toolSet.tools).toEqual([]);
    });
  });

  describe('hidden Agent Signal skill-management tools are fully blocked for share visitors', () => {
    // `lobe-skill-maintainer` and `agent-signal-skill-management` are hidden,
    // system-only tools whose every API writes agent-document rows under the
    // creator's account (`SkillManagementDocumentService` →
    // `AgentDocumentModel(db, userId, workspaceId)`), and a v1 share never
    // grants write access. `agentId` on both is genuinely context-scoped (not
    // model-suppliable — see the `SHARE_VISITOR_BLOCKED_IDENTIFIERS` JSDoc),
    // but they are listed anyway as defense in depth: reproduces the real
    // manifests as if whitelisted, to prove the identifier-level strip covers
    // them regardless of how they got into the tool set.
    it.each([
      { apiNames: Object.values(SkillMaintainerApiName), identifier: SkillMaintainerIdentifier },
      {
        apiNames: [...AGENT_SIGNAL_SKILL_MANAGEMENT_TOOL_API_NAMES],
        identifier: AGENT_SIGNAL_SKILL_MANAGEMENT_IDENTIFIER,
      },
    ])(
      'removes $identifier entirely from every surface, even when explicitly whitelisted',
      ({ identifier, apiNames }) => {
        const manifest =
          identifier === SkillMaintainerIdentifier
            ? SkillMaintainerManifest
            : agentSignalSkillManagementManifest;
        const gate = buildGate({ enabledToolIds: [identifier] });
        const toolSet: ShareGateToolSet = {
          activatableToolIds: [identifier],
          enabledToolIds: [identifier],
          executorMap: { [identifier]: 'server' as any },
          manifestMap: { [identifier]: manifest },
          sourceMap: { [identifier]: 'builtin' } as any,
          tools: apiNames.map((apiName) => ({
            function: { name: `${identifier}____${apiName}` },
            type: 'function',
          })),
        };

        applyShareGateToToolSet(toolSet, gate);

        expect(toolSet.manifestMap[identifier]).toBeUndefined();
        expect(toolSet.sourceMap[identifier]).toBeUndefined();
        expect(toolSet.executorMap[identifier]).toBeUndefined();
        expect(toolSet.enabledToolIds).not.toContain(identifier);
        expect(toolSet.activatableToolIds).not.toContain(identifier);
        expect(toolSet.tools).toEqual([]);
      },
    );
  });

  describe('data-tool access (memory / knowledge base / agent documents)', () => {
    // Reproduces the fully-assembled tool set for a share that whitelisted all
    // three data-bearing tools (`enabledToolIds` says "id is enabled") but
    // never granted read access to any of them (`allowReadMemory` unset,
    // `filePermissionConfig` unset) — the exact shape that let a share
    // visitor execute these tools read-write under the creator's own
    // credentials before this gate existed. Built from the REAL exported
    // manifests so a rename/addition of an API is caught by these assertions
    // instead of silently reopening the hole.
    const buildDataToolSet = (): ShareGateToolSet => ({
      activatableToolIds: [MemoryIdentifier, KnowledgeBaseIdentifier, AgentDocumentsIdentifier],
      enabledToolIds: [MemoryIdentifier, KnowledgeBaseIdentifier, AgentDocumentsIdentifier],
      executorMap: {
        [AgentDocumentsIdentifier]: 'server' as any,
        [KnowledgeBaseIdentifier]: 'server' as any,
        [MemoryIdentifier]: 'server' as any,
      },
      manifestMap: {
        [AgentDocumentsIdentifier]: AgentDocumentsManifest,
        [KnowledgeBaseIdentifier]: KnowledgeBaseManifest,
        [MemoryIdentifier]: MemoryManifest,
      },
      sourceMap: {
        [AgentDocumentsIdentifier]: 'builtin',
        [KnowledgeBaseIdentifier]: 'builtin',
        [MemoryIdentifier]: 'builtin',
      } as any,
      tools: [
        ...MemoryManifest.api.map((api) => ({
          function: { name: `${MemoryIdentifier}____${api.name}` },
          type: 'function',
        })),
        ...KnowledgeBaseManifest.api.map((api) => ({
          function: { name: `${KnowledgeBaseIdentifier}____${api.name}` },
          type: 'function',
        })),
        ...AgentDocumentsManifest.api.map((api) => ({
          function: { name: `${AgentDocumentsIdentifier}____${api.name}` },
          type: 'function',
        })),
      ],
    });

    it('drops memory/knowledge-base/agent-documents entirely when the whitelist enables them but the share grants no access', () => {
      const gate = buildGate({
        enabledToolIds: [MemoryIdentifier, KnowledgeBaseIdentifier, AgentDocumentsIdentifier],
        // No `allowReadMemory`, no `filePermissionConfig` — an unconfigured
        // grant is `none`, same as an explicit 'none'.
      });
      const toolSet = buildDataToolSet();

      applyShareGateToToolSet(toolSet, gate);

      for (const identifier of [
        MemoryIdentifier,
        KnowledgeBaseIdentifier,
        AgentDocumentsIdentifier,
      ]) {
        expect(toolSet.manifestMap[identifier]).toBeUndefined();
        expect(toolSet.sourceMap[identifier]).toBeUndefined();
        expect(toolSet.executorMap[identifier]).toBeUndefined();
        expect(toolSet.enabledToolIds).not.toContain(identifier);
        expect(toolSet.activatableToolIds).not.toContain(identifier);
      }
      expect(toolSet.tools).toEqual([]);
    });

    it('keeps read APIs but strips every write API once the share grants read access', () => {
      const gate = buildGate({
        allowReadMemory: true,
        enabledToolIds: [MemoryIdentifier, KnowledgeBaseIdentifier, AgentDocumentsIdentifier],
        filePermissionConfig: {
          agentFiles: 'read',
          knowledgeBase: 'read',
          uploadAllowed: false,
        },
      });
      const toolSet = buildDataToolSet();

      applyShareGateToToolSet(toolSet, gate);

      const memoryApis = toolSet.manifestMap[MemoryIdentifier].api.map((api) => api.name);
      const knowledgeApis = toolSet.manifestMap[KnowledgeBaseIdentifier].api.map((api) => api.name);
      const documentApis = toolSet.manifestMap[AgentDocumentsIdentifier].api.map((api) => api.name);

      // Read APIs survive.
      expect(memoryApis).toEqual(
        expect.arrayContaining([
          MemoryApiName.searchUserMemory,
          MemoryApiName.queryTaxonomyOptions,
        ]),
      );
      // `viewKnowledgeBase` / `searchKnowledgeBase` survive: `searchKnowledgeBase`
      // is already agent/task-id scoped server-side, and `viewKnowledgeBase`'s
      // `id` argument is checked per-call against the agent's own assignment
      // (see the `isArgsOutOfScope` coverage below) — the manifest can't
      // pre-filter that, so it stays offered.
      expect(knowledgeApis).toEqual(
        expect.arrayContaining([
          KnowledgeBaseApiName.viewKnowledgeBase,
          KnowledgeBaseApiName.searchKnowledgeBase,
        ]),
      );
      // `listFiles` / `getFileDetail` (the creator's whole resource library)
      // and `listKnowledgeBases` / `readKnowledge` (every KB/file the creator
      // owns, not just this agent's assignment) have no id to scope by, so a
      // `read` grant never offers them — this is the P1 fix: previously these
      // survived a `read` grant and let a visitor enumerate + read the
      // creator's entire resource library regardless of what was actually
      // assigned to the shared agent.
      expect(knowledgeApis).not.toContain(KnowledgeBaseApiName.listFiles);
      expect(knowledgeApis).not.toContain(KnowledgeBaseApiName.getFileDetail);
      expect(knowledgeApis).not.toContain(KnowledgeBaseApiName.listKnowledgeBases);
      expect(knowledgeApis).not.toContain(KnowledgeBaseApiName.readKnowledge);
      expect(documentApis).toEqual(
        expect.arrayContaining([
          AgentDocumentsApiName.listDocuments,
          AgentDocumentsApiName.readDocument,
        ]),
      );

      // Every write API is gone — from the manifest AND the function-calling
      // `tools` schema — regardless of the 'read' grant (v1 shares have no
      // write grant to honor).
      const memoryWriteApis = [
        MemoryApiName.addActivityMemory,
        MemoryApiName.addContextMemory,
        MemoryApiName.addExperienceMemory,
        MemoryApiName.addIdentityMemory,
        MemoryApiName.addPreferenceMemory,
        MemoryApiName.removeIdentityMemory,
        MemoryApiName.updateIdentityMemory,
      ];
      const knowledgeWriteApis = [
        KnowledgeBaseApiName.createKnowledgeBase,
        KnowledgeBaseApiName.deleteKnowledgeBase,
        KnowledgeBaseApiName.createDocument,
        KnowledgeBaseApiName.addFiles,
        KnowledgeBaseApiName.removeFiles,
      ];
      const documentWriteApis = [
        AgentDocumentsApiName.createDocument,
        AgentDocumentsApiName.copyDocument,
        AgentDocumentsApiName.modifyNodes,
        AgentDocumentsApiName.removeDocument,
        AgentDocumentsApiName.renameDocument,
        AgentDocumentsApiName.replaceDocumentContent,
        AgentDocumentsApiName.updateLoadRule,
      ];

      for (const apiName of memoryWriteApis) expect(memoryApis).not.toContain(apiName);
      for (const apiName of knowledgeWriteApis) expect(knowledgeApis).not.toContain(apiName);
      for (const apiName of documentWriteApis) expect(documentApis).not.toContain(apiName);

      const knowledgeAlwaysBlockedApis = [
        KnowledgeBaseApiName.listFiles,
        KnowledgeBaseApiName.getFileDetail,
        KnowledgeBaseApiName.listKnowledgeBases,
        KnowledgeBaseApiName.readKnowledge,
      ];

      const toolNames = toolSet.tools!.map((tool) => tool.function.name);
      for (const apiName of [
        ...memoryWriteApis,
        ...knowledgeWriteApis,
        ...documentWriteApis,
        ...knowledgeAlwaysBlockedApis,
      ]) {
        expect(toolNames.some((name) => name.endsWith(`____${apiName}`))).toBe(false);
      }

      // The identifiers themselves stay enabled (they were whitelisted and
      // granted read access).
      expect(toolSet.enabledToolIds).toEqual(
        expect.arrayContaining([
          MemoryIdentifier,
          KnowledgeBaseIdentifier,
          AgentDocumentsIdentifier,
        ]),
      );
    });
  });
});

describe('isShareBlockedDataToolCall', () => {
  it('blocks every API when the grant is none (unset permissions)', () => {
    expect(isShareBlockedDataToolCall({}, MemoryIdentifier, MemoryApiName.searchUserMemory)).toBe(
      true,
    );
    expect(
      isShareBlockedDataToolCall({}, KnowledgeBaseIdentifier, KnowledgeBaseApiName.listFiles),
    ).toBe(true);
    expect(
      isShareBlockedDataToolCall({}, AgentDocumentsIdentifier, AgentDocumentsApiName.listDocuments),
    ).toBe(true);
  });

  it('blocks writes but allows reads once granted', () => {
    const permissions = {
      allowReadMemory: true,
      filePermissionConfig: { agentFiles: 'read' as const, knowledgeBase: 'read' as const },
    };

    expect(
      isShareBlockedDataToolCall(permissions, MemoryIdentifier, MemoryApiName.searchUserMemory),
    ).toBe(false);
    expect(
      isShareBlockedDataToolCall(permissions, MemoryIdentifier, MemoryApiName.addContextMemory),
    ).toBe(true);

    expect(
      isShareBlockedDataToolCall(
        permissions,
        KnowledgeBaseIdentifier,
        KnowledgeBaseApiName.searchKnowledgeBase,
      ),
    ).toBe(false);
    expect(
      isShareBlockedDataToolCall(
        permissions,
        KnowledgeBaseIdentifier,
        KnowledgeBaseApiName.createKnowledgeBase,
      ),
    ).toBe(true);

    expect(
      isShareBlockedDataToolCall(
        permissions,
        AgentDocumentsIdentifier,
        AgentDocumentsApiName.readDocument,
      ),
    ).toBe(false);
    expect(
      isShareBlockedDataToolCall(
        permissions,
        AgentDocumentsIdentifier,
        AgentDocumentsApiName.removeDocument,
      ),
    ).toBe(true);
  });

  it('never blocks tools outside the data-tool registry', () => {
    expect(isShareBlockedDataToolCall({}, 'web-search', 'search')).toBe(false);
  });

  describe('lobe-agent-management is fully blocked at dispatch time', () => {
    // This is the unbypassable enforcement layer: `BuiltinToolsExecutor.execute`
    // (builtin.ts) routes strictly by `payload.apiName` and never re-consults
    // the (possibly already-trimmed) manifest, so a model that still emits a
    // `lobe-agent-management` call — hallucinated, replayed, or injected via a
    // crafted prompt — must be blocked here regardless of what permissions
    // the share otherwise grants (memory/knowledge-base read, etc.).
    //
    // Built from the REAL exported `AgentManagementApiName` enum, not a
    // hand-picked subset, so adding a new API to the tool is covered by this
    // test automatically instead of silently reopening the hole.
    it.each(Object.values(AgentManagementApiName))('blocks %s unconditionally', (apiName) => {
      expect(
        isShareBlockedDataToolCall(
          {
            allowReadMemory: true,
            filePermissionConfig: { agentFiles: 'read', knowledgeBase: 'read' },
          },
          AgentManagementIdentifier,
          apiName,
          { agentId: 'creator-agent-id' },
        ),
      ).toBe(true);
    });

    it('blocks even with no args at all', () => {
      expect(
        isShareBlockedDataToolCall(
          {},
          AgentManagementIdentifier,
          AgentManagementApiName.searchAgent,
        ),
      ).toBe(true);
    });
  });

  describe('hidden Agent Signal skill-management tools are fully blocked at dispatch time', () => {
    // Same unbypassable-dispatch reasoning as the `lobe-agent-management`
    // suite above, applied to the two hidden skill-management tools
    // (`lobe-skill-maintainer`, `agent-signal-skill-management`). Their
    // `agentId` is genuinely context-scoped (never taken from `args` — see the
    // `SHARE_VISITOR_BLOCKED_IDENTIFIERS` JSDoc in shareGate.ts), so this is
    // pure defense in depth: even a context-scoped write to the CREATOR's own
    // shared-agent document store is still a write, and v1 shares never grant
    // write access. Built from the REAL exported API name lists so a future
    // API addition to either tool is covered automatically.
    it.each([
      { apiNames: Object.values(SkillMaintainerApiName), identifier: SkillMaintainerIdentifier },
      {
        apiNames: [...AGENT_SIGNAL_SKILL_MANAGEMENT_TOOL_API_NAMES],
        identifier: AGENT_SIGNAL_SKILL_MANAGEMENT_IDENTIFIER,
      },
    ])('blocks every API on $identifier unconditionally', ({ identifier, apiNames }) => {
      for (const apiName of apiNames) {
        expect(
          isShareBlockedDataToolCall(
            {
              allowReadMemory: true,
              filePermissionConfig: { agentFiles: 'read', knowledgeBase: 'read' },
            },
            identifier,
            apiName,
            { agentId: 'attempted-agent-id-override', skillDocumentId: 'sd-1' },
          ),
        ).toBe(true);
      }
    });
  });

  describe('lobe-task is fully blocked at dispatch time', () => {
    // Unbypassable enforcement layer, same reasoning as the
    // `lobe-agent-management` suite above: `BuiltinToolsExecutor.execute`
    // (builtin.ts) routes strictly by `payload.apiName`/`args` and never
    // re-consults the (possibly already-trimmed) manifest, so a model that
    // still emits a `lobe-task` call must be blocked here regardless of the
    // arguments — including the concrete cross-topic/cross-agent leak this
    // hole allowed: reading or mutating a task the visitor never created,
    // and enumerating the creator's whole workspace via `scope: 'allAgents'`.
    //
    // Built from the REAL exported `TaskApiName` enum, not a hand-picked
    // subset, so adding a new API to the tool is covered automatically.
    it.each(Object.values(TaskApiName))('blocks %s unconditionally', (apiName) => {
      expect(isShareBlockedDataToolCall({}, TaskIdentifier, apiName)).toBe(true);
    });

    it("blocks resolving a task identifier from outside the visitor's own topic (viewTask/editTask/deleteTask cross-topic read)", () => {
      // `TaskModel.resolve` has no topic filter at all — it is scoped only by
      // the creator's `userId`/`workspaceId` — so a visitor supplying ANY
      // identifier from the creator's workspace (created by another agent, in
      // another topic, possibly before this share ever existed) would
      // otherwise resolve successfully. This asserts the block holds
      // regardless of which identifier or which API is targeted.
      expect(
        isShareBlockedDataToolCall({}, TaskIdentifier, TaskApiName.viewTask, {
          identifier: 'T-999-from-another-topic',
        }),
      ).toBe(true);
      expect(
        isShareBlockedDataToolCall({}, TaskIdentifier, TaskApiName.editTask, {
          identifier: 'T-999-from-another-topic',
          name: 'renamed by visitor',
        }),
      ).toBe(true);
      expect(
        isShareBlockedDataToolCall({}, TaskIdentifier, TaskApiName.deleteTask, {
          identifier: 'T-999-from-another-topic',
        }),
      ).toBe(true);
    });

    it("blocks listTasks with scope: 'allAgents' — the tool's advertised whole-workspace enumeration", () => {
      expect(
        isShareBlockedDataToolCall({}, TaskIdentifier, TaskApiName.listTasks, {
          scope: 'allAgents',
        }),
      ).toBe(true);
    });

    it('blocks even with no args at all', () => {
      expect(isShareBlockedDataToolCall({}, TaskIdentifier, TaskApiName.viewTask)).toBe(true);
    });
  });

  describe('lobe-knowledge-base creator-scoped reads', () => {
    const readPermissions = {
      filePermissionConfig: { knowledgeBase: 'read' as const },
      knowledgeBaseIds: ['kb-mounted-1', 'kb-mounted-2'],
    };

    it("blocks listFiles / getFileDetail / listKnowledgeBases / readKnowledge outright even under a read grant — they read the creator's whole personal store with no id to scope to this agent", () => {
      expect(
        isShareBlockedDataToolCall(
          readPermissions,
          KnowledgeBaseIdentifier,
          KnowledgeBaseApiName.listFiles,
          {},
        ),
      ).toBe(true);
      expect(
        isShareBlockedDataToolCall(
          readPermissions,
          KnowledgeBaseIdentifier,
          KnowledgeBaseApiName.getFileDetail,
          { id: 'file-anything' },
        ),
      ).toBe(true);
      expect(
        isShareBlockedDataToolCall(
          readPermissions,
          KnowledgeBaseIdentifier,
          KnowledgeBaseApiName.listKnowledgeBases,
          {},
        ),
      ).toBe(true);
      expect(
        isShareBlockedDataToolCall(
          readPermissions,
          KnowledgeBaseIdentifier,
          KnowledgeBaseApiName.readKnowledge,
          { fileIds: ['file-anything'] },
        ),
      ).toBe(true);
    });

    it('allows viewKnowledgeBase for a knowledge base actually assigned to the agent', () => {
      expect(
        isShareBlockedDataToolCall(
          readPermissions,
          KnowledgeBaseIdentifier,
          KnowledgeBaseApiName.viewKnowledgeBase,
          { id: 'kb-mounted-1' },
        ),
      ).toBe(false);
    });

    it('blocks viewKnowledgeBase for a knowledge base the visitor supplies but the agent is not assigned — the P1 enumeration path', () => {
      // A visitor-supplied id outside the agent's own assignment must be
      // rejected even though the identifier's grant is 'read' — the grant
      // means "read what this agent is assigned," not "read any knowledge
      // base the creator owns."
      expect(
        isShareBlockedDataToolCall(
          readPermissions,
          KnowledgeBaseIdentifier,
          KnowledgeBaseApiName.viewKnowledgeBase,
          { id: 'kb-not-mounted' },
        ),
      ).toBe(true);
    });

    it('fails closed when the id is missing, the wrong type, or the assignment set itself is empty/absent', () => {
      expect(
        isShareBlockedDataToolCall(
          readPermissions,
          KnowledgeBaseIdentifier,
          KnowledgeBaseApiName.viewKnowledgeBase,
          {},
        ),
      ).toBe(true);
      expect(
        isShareBlockedDataToolCall(
          readPermissions,
          KnowledgeBaseIdentifier,
          KnowledgeBaseApiName.viewKnowledgeBase,
          { id: 42 },
        ),
      ).toBe(true);
      expect(
        isShareBlockedDataToolCall(
          {
            filePermissionConfig: { knowledgeBase: 'read' as const },
            knowledgeBaseIds: [],
          },
          KnowledgeBaseIdentifier,
          KnowledgeBaseApiName.viewKnowledgeBase,
          { id: 'kb-mounted-1' },
        ),
      ).toBe(true);
      expect(
        isShareBlockedDataToolCall(
          { filePermissionConfig: { knowledgeBase: 'read' as const } },
          KnowledgeBaseIdentifier,
          KnowledgeBaseApiName.viewKnowledgeBase,
          { id: 'kb-mounted-1' },
        ),
      ).toBe(true);
    });
  });
});

/**
 * The master allowlist this PR introduces (`SHARE_VISITOR_ALLOWED_IDENTIFIERS`,
 * not exported — internal to shareGate.ts by design, see its JSDoc). Mirrored
 * here so the suites below can assert against the REAL exported
 * `@lobechat/builtin-tools` registry instead of a hand-picked identifier list:
 * every builtin identifier NOT in this set is expected to be denied, so any
 * future registration that forgets to update shareGate.ts's allowlist shows up
 * here as a new "denied" entry — the test itself doesn't need to change, only
 * a human has to decide whether the new tool belongs on the allowlist.
 *
 * `lobe-knowledge-base` / `lobe-user-memory` / `lobe-agent-documents` are
 * intentionally excluded from this mirror — they ARE on the real allowlist,
 * but their survival in `applyShareGateToToolSet` also depends on
 * `DATA_TOOL_ACCESS_RULES`'s per-share grant (see the dedicated "data-tool
 * access" suite above), so a generic "enabledToolIds says yes" gate assertion
 * for them would incorrectly fail without also passing `allowReadMemory`/
 * `filePermissionConfig`.
 */
const MIRRORED_ALLOWED_IDENTIFIERS = new Set<string>([
  TopicReferenceIdentifier,
  CalculatorIdentifier,
  WebBrowsingManifest.identifier,
  UserInteractionIdentifier,
  LobeActivatorIdentifier,
  ImageGenerationIdentifier,
  VerifyToolIdentifier,
  AcceptanceEvidenceIdentifier,
  LobeAgentIdentifier,
]);

const DATA_TOOL_IDENTIFIERS = new Set<string>([
  KnowledgeBaseIdentifier,
  MemoryIdentifier,
  AgentDocumentsIdentifier,
]);

describe('default-deny covers every registered builtin identifier not explicitly allowed', () => {
  const allRealBuiltinIdentifiers = builtinTools.map((tool) => tool.identifier);
  const deniedBuiltinIdentifiers = allRealBuiltinIdentifiers.filter(
    (id) => !MIRRORED_ALLOWED_IDENTIFIERS.has(id) && !DATA_TOOL_IDENTIFIERS.has(id),
  );

  it('includes every tool a completed security audit found leaking creator data, plus every tool withheld for lack of positive safety evidence', () => {
    // Confirmed leak paths.
    expect(deniedBuiltinIdentifiers).toEqual(
      expect.arrayContaining([
        AgentManagementIdentifier,
        AGENT_SIGNAL_REVIEW_IDENTIFIER,
        SkillMaintainerIdentifier,
        AGENT_SIGNAL_SKILL_MANAGEMENT_IDENTIFIER,
        TaskIdentifier,
        'lobe-creds',
        'lobe-message',
        'lobe-skill-store',
        'lobe-agent-builder',
        'lobe-skills',
        'lobe-group-agent-builder',
        'lobe-group-management',
        BriefIdentifier,
      ]),
    );
    // Denied for lack of positive safety evidence — see shareGate.ts's
    // denied-bucket rationale comment for why each stays out.
    expect(deniedBuiltinIdentifiers).toEqual(
      expect.arrayContaining([
        'lobe-local-system',
        'lobe-browser',
        'lobe-remote-device',
        'lobe-cloud-sandbox',
        'lobe-web-onboarding',
        'lobe-goal',
        'lobe-self-feedback-intent',
        'agent-signal-reflection',
        'agent-signal-feedback-intent',
      ]),
    );
    // Denied for being visitor-unreachable rather than unsafe — see
    // shareGate.ts's `lobe-page-agent` denied-bucket entry (LOBE-11930 codex
    // P2): `execAgent` always strips it outside `appContext.scope === 'page'`,
    // and a share visitor's `appContext` never carries that scope.
    expect(deniedBuiltinIdentifiers).toContain(PageAgentIdentifier);
  });

  it.each(deniedBuiltinIdentifiers)(
    'blocks %s unconditionally at dispatch time, regardless of the share permissions granted',
    (identifier) => {
      expect(
        isShareBlockedDataToolCall(
          {
            allowReadMemory: true,
            filePermissionConfig: { agentFiles: 'read', knowledgeBase: 'read' },
          },
          identifier,
          'anyApiName',
          { anything: 'goes' },
        ),
      ).toBe(true);
    },
  );

  it('strips every denied identifier from the assembled tool set even when the owner explicitly whitelists all of them', () => {
    const gate = buildGate({ enabledToolIds: deniedBuiltinIdentifiers });
    const toolSet: ShareGateToolSet = {
      activatableToolIds: [...deniedBuiltinIdentifiers],
      enabledToolIds: [...deniedBuiltinIdentifiers],
      executorMap: Object.fromEntries(deniedBuiltinIdentifiers.map((id) => [id, 'server' as any])),
      manifestMap: Object.fromEntries(
        deniedBuiltinIdentifiers.map((id) => [
          id,
          { api: [], identifier: id, type: 'default' } as any,
        ]),
      ),
      sourceMap: Object.fromEntries(deniedBuiltinIdentifiers.map((id) => [id, 'builtin' as any])),
      tools: deniedBuiltinIdentifiers.map((id) => ({
        function: { name: `${id}____someApi` },
        type: 'function',
      })),
    };

    applyShareGateToToolSet(toolSet, gate);

    expect(toolSet.enabledToolIds).toEqual([]);
    expect(toolSet.activatableToolIds).toEqual([]);
    expect(toolSet.manifestMap).toEqual({});
    expect(toolSet.sourceMap).toEqual({});
    expect(toolSet.executorMap).toEqual({});
    expect(toolSet.tools).toEqual([]);
  });

  it('denies a hypothetical unknown identifier the same way — proving this is default-deny, not a hand-maintained blocklist', () => {
    const unknownIdentifier = 'lobe-not-yet-registered-tool';

    // Never registered in `@lobechat/builtin-tools`, so it is NOT governed by
    // this allowlist at all — it is left to `filterPluginsByShareGate` /
    // `shareConfig.enabledToolIds`, same as any MCP/market/custom plugin.
    expect(isShareBlockedDataToolCall({}, unknownIdentifier, 'anyApiName')).toBe(false);

    // A builtin identifier that is real (so `isGovernedByBuiltinAllowlist`
    // matches it) but happens not to be in the mirrored allowed set stands in
    // for "a tool registered after the allowlist was written, before anyone
    // added it here" — every one of `deniedBuiltinIdentifiers` already proves
    // this, e.g. the newest addition among them:
    expect(deniedBuiltinIdentifiers.length).toBeGreaterThan(0);
  });
});

/**
 * Regression coverage for the `agent-signal-review` removal (codex review
 * finding on `shareGate.ts:192`): a completed trace of
 * `createReviewRuntimePrimitives` (`apps/server/src/services/agentSignal/services/
 * selfIteration/review/server.ts`) found this identifier was previously
 * allowlisted on an unverified "scoped by `context.operationId`, fails
 * closed" claim that never actually held for it — `listManagedSkills` /
 * `getManagedSkill` honor a model-supplied `agentId` that overrides the
 * server-bound one (cross-agent read of another agent's private skills), and
 * `writeMemory` / `createSkillIfAbsent` / `replaceSkillContentCAS` are
 * unconditional creator-scoped mutations with no corresponding
 * `DATA_TOOL_ACCESS_RULES` entry to narrow them. Asserted here against the
 * REAL exported `AGENT_SIGNAL_REVIEW_TOOL_API_NAMES` manifest so a rename or
 * a future re-allowlisting attempt has to consciously re-derive safety
 * instead of silently reopening the hole this test guards.
 */
describe('agent-signal-review: cross-agent read and mutation stay blocked for share visitors', () => {
  const fullyGrantedPermissions = {
    allowReadMemory: true,
    filePermissionConfig: { agentFiles: 'read' as const, knowledgeBase: 'read' as const },
  };

  it('is absent from the master allowlist entirely', () => {
    expect(MIRRORED_ALLOWED_IDENTIFIERS.has(AGENT_SIGNAL_REVIEW_IDENTIFIER)).toBe(false);
  });

  it.each(AGENT_SIGNAL_REVIEW_TOOL_API_NAMES)(
    'blocks %s unconditionally at dispatch time, even under a fully-granted share',
    (apiName) => {
      expect(
        isShareBlockedDataToolCall(
          fullyGrantedPermissions,
          AGENT_SIGNAL_REVIEW_IDENTIFIER,
          apiName,
        ),
      ).toBe(true);
    },
  );

  it('blocks a cross-agent listManagedSkills read that targets another agent by id', () => {
    expect(
      isShareBlockedDataToolCall(
        fullyGrantedPermissions,
        AGENT_SIGNAL_REVIEW_IDENTIFIER,
        'listManagedSkills',
        {
          agentId: 'some-other-creator-owned-agent',
        },
      ),
    ).toBe(true);
  });

  it('blocks a cross-agent getManagedSkill read that targets another agent by id', () => {
    expect(
      isShareBlockedDataToolCall(
        fullyGrantedPermissions,
        AGENT_SIGNAL_REVIEW_IDENTIFIER,
        'getManagedSkill',
        {
          agentId: 'some-other-creator-owned-agent',
          skillDocumentId: 'skill-doc-1',
        },
      ),
    ).toBe(true);
  });

  it('blocks writeMemory, createSkillIfAbsent, and replaceSkillContentCAS mutations', () => {
    for (const apiName of ['writeMemory', 'createSkillIfAbsent', 'replaceSkillContentCAS']) {
      expect(
        isShareBlockedDataToolCall(
          fullyGrantedPermissions,
          AGENT_SIGNAL_REVIEW_IDENTIFIER,
          apiName,
          {
            bodyMarkdown: '# hijacked',
            content: 'hijacked memory write',
            name: 'hijacked-skill',
          },
        ),
      ).toBe(true);
    }
  });

  it('strips the identifier from the assembled tool set even when the owner whitelists it', () => {
    const gate = buildGate({ enabledToolIds: [AGENT_SIGNAL_REVIEW_IDENTIFIER] });
    const toolSet: ShareGateToolSet = {
      activatableToolIds: [AGENT_SIGNAL_REVIEW_IDENTIFIER],
      enabledToolIds: [AGENT_SIGNAL_REVIEW_IDENTIFIER],
      executorMap: { [AGENT_SIGNAL_REVIEW_IDENTIFIER]: 'server' as any },
      manifestMap: {
        [AGENT_SIGNAL_REVIEW_IDENTIFIER]: {
          api: [],
          identifier: AGENT_SIGNAL_REVIEW_IDENTIFIER,
          type: 'default',
        } as any,
      },
      sourceMap: { [AGENT_SIGNAL_REVIEW_IDENTIFIER]: 'builtin' as any },
      tools: [
        {
          function: { name: `${AGENT_SIGNAL_REVIEW_IDENTIFIER}____listManagedSkills` },
          type: 'function',
        },
      ],
    };

    applyShareGateToToolSet(toolSet, gate);

    expect(toolSet.enabledToolIds).toEqual([]);
    expect(toolSet.manifestMap).toEqual({});
    expect(toolSet.tools).toEqual([]);
  });
});

/**
 * Regression coverage for the `lobe-brief` removal (codex P1 finding on
 * `packages/builtin-tools/src/index.ts:219`): `createBrief`
 * (`briefRuntime.createBrief`, `apps/server/src/services/toolExecution/
 * serverRuntimes/brief.ts:60-68`) unconditionally persists a new brief via
 * `BriefModel.create`, constructed with the CREATOR's `userId`, and the
 * manifest never marks it as requiring intervention — only `requestCheckpoint`
 * does (`packages/builtin-tool-brief/src/manifest.ts`). Asserted against the
 * REAL exported `BriefApiName` so a future re-allowlisting attempt has to
 * consciously re-derive safety instead of silently reopening the hole.
 */
describe('lobe-brief: unconditional persistence with no humanIntervention marker stays blocked for share visitors', () => {
  const fullyGrantedPermissions = {
    allowReadMemory: true,
    filePermissionConfig: { agentFiles: 'read' as const, knowledgeBase: 'read' as const },
  };

  it('is absent from the master allowlist entirely', () => {
    expect(MIRRORED_ALLOWED_IDENTIFIERS.has(BriefIdentifier)).toBe(false);
  });

  it.each(Object.values(BriefApiName))(
    'blocks %s unconditionally at dispatch time, even under a fully-granted share',
    (apiName) => {
      expect(isShareBlockedDataToolCall(fullyGrantedPermissions, BriefIdentifier, apiName)).toBe(
        true,
      );
    },
  );

  it('strips the identifier from the assembled tool set even when the owner whitelists it', () => {
    const gate = buildGate({ enabledToolIds: [BriefIdentifier] });
    const toolSet: ShareGateToolSet = {
      activatableToolIds: [BriefIdentifier],
      enabledToolIds: [BriefIdentifier],
      executorMap: { [BriefIdentifier]: 'server' as any },
      manifestMap: {
        [BriefIdentifier]: { api: [], identifier: BriefIdentifier, type: 'default' } as any,
      },
      sourceMap: { [BriefIdentifier]: 'builtin' as any },
      tools: [
        {
          function: { name: `${BriefIdentifier}____${BriefApiName.createBrief}` },
          type: 'function',
        },
      ],
    };

    applyShareGateToToolSet(toolSet, gate);

    expect(toolSet.enabledToolIds).toEqual([]);
    expect(toolSet.manifestMap).toEqual({});
    expect(toolSet.tools).toEqual([]);
  });
});

/**
 * Regression coverage for the `lobe-page-agent` removal (codex P2 finding on
 * `packages/builtin-tools/src/index.ts:218`): unlike every other identifier
 * removed above, this is not a data leak — `PageAgentExecutionRuntime` only
 * ever acts on the caller's own open page/document editor. The bug is that
 * `AiAgentService.execAgent` (`apps/server/src/services/aiAgent/index.ts:1737-1739`)
 * unconditionally strips `PageAgentIdentifier` from `activePluginIds` whenever
 * `appContext?.scope !== 'page'`, and the share visitor path (`shareChat.ts`'s
 * `execAgent` procedure) always builds `appContext` as `{ topicId }` — never
 * `scope: 'page'` — so the strip fires on every visitor turn. Allowlisting it
 * anyway let the owner-facing share settings picker confirm a tool grant no
 * shared conversation could ever exercise. Asserted here against the REAL
 * exported `DocumentApiName` enum so a future re-allowlisting attempt has to
 * consciously re-derive reachability instead of silently reopening the gap.
 */
describe('lobe-page-agent: unreachable for a share visitor run (appContext never carries scope: "page"), so it stays off the allowlist', () => {
  it('is absent from the master allowlist entirely', () => {
    expect(MIRRORED_ALLOWED_IDENTIFIERS.has(PageAgentIdentifier)).toBe(false);
  });

  it.each(Object.values(DocumentApiName))(
    'blocks %s unconditionally at dispatch time, even under a fully-granted share',
    (apiName) => {
      expect(
        isShareBlockedDataToolCall(
          {
            allowReadMemory: true,
            filePermissionConfig: { agentFiles: 'read', knowledgeBase: 'read' },
          },
          PageAgentIdentifier,
          apiName,
        ),
      ).toBe(true);
    },
  );

  it('strips the identifier from the assembled tool set even when the owner whitelists it', () => {
    const gate = buildGate({ enabledToolIds: [PageAgentIdentifier] });
    const toolSet: ShareGateToolSet = {
      activatableToolIds: [PageAgentIdentifier],
      enabledToolIds: [PageAgentIdentifier],
      executorMap: { [PageAgentIdentifier]: 'server' as any },
      manifestMap: {
        [PageAgentIdentifier]: { api: [], identifier: PageAgentIdentifier, type: 'default' } as any,
      },
      sourceMap: { [PageAgentIdentifier]: 'builtin' as any },
      tools: [
        {
          function: { name: `${PageAgentIdentifier}____${DocumentApiName.getPageContent}` },
          type: 'function',
        },
      ],
    };

    applyShareGateToToolSet(toolSet, gate);

    expect(toolSet.enabledToolIds).toEqual([]);
    expect(toolSet.manifestMap).toEqual({});
    expect(toolSet.tools).toEqual([]);
  });
});

describe('allowed builtin identifiers survive the owner allowlist intersection', () => {
  it.each([...MIRRORED_ALLOWED_IDENTIFIERS])(
    'keeps %s enabled when the owner whitelists it, with no DATA_TOOL_ACCESS_RULES entry to further narrow it',
    (identifier) => {
      const gate = buildGate({ enabledToolIds: [identifier] });
      const toolSet: ShareGateToolSet = {
        activatableToolIds: [identifier],
        enabledToolIds: [identifier],
        executorMap: { [identifier]: 'server' as any },
        manifestMap: { [identifier]: { api: [], identifier, type: 'default' } as any },
        sourceMap: { [identifier]: 'builtin' as any },
        tools: [{ function: { name: `${identifier}____someApi` }, type: 'function' }],
      };

      applyShareGateToToolSet(toolSet, gate);

      expect(toolSet.enabledToolIds).toContain(identifier);
      expect(toolSet.activatableToolIds).toContain(identifier);
      expect(toolSet.manifestMap[identifier]).toBeDefined();
      expect(toolSet.sourceMap[identifier]).toBeDefined();
      expect(toolSet.executorMap[identifier]).toBeDefined();

      expect(
        isShareBlockedDataToolCall(
          {
            allowReadMemory: true,
            filePermissionConfig: { agentFiles: 'read', knowledgeBase: 'read' },
          },
          identifier,
          'someApiName',
        ),
      ).toBe(false);
    },
  );

  it('never allows a builtin identifier the owner did not whitelist, even though it is on the master allowlist', () => {
    const gate = buildGate({ enabledToolIds: [] });
    const toolSet: ShareGateToolSet = {
      activatableToolIds: [CalculatorIdentifier],
      enabledToolIds: [CalculatorIdentifier],
      executorMap: { [CalculatorIdentifier]: 'server' as any },
      manifestMap: {
        [CalculatorIdentifier]: {
          api: [],
          identifier: CalculatorIdentifier,
          type: 'default',
        } as any,
      },
      sourceMap: { [CalculatorIdentifier]: 'builtin' as any },
      tools: [],
    };

    applyShareGateToToolSet(toolSet, gate);

    expect(toolSet.enabledToolIds).toEqual([]);
    expect(toolSet.manifestMap).toEqual({});
  });
});

describe('non-builtin identifiers (MCP / market / custom plugins) are governed only by the owner allowlist, never by the builtin master allowlist', () => {
  it('keeps a non-builtin identifier whitelisted by the owner, even though it is not a known builtin', () => {
    const gate = buildGate({ enabledToolIds: ['mcp-github', 'composio-slack'] });
    const toolSet: ShareGateToolSet = {
      activatableToolIds: ['mcp-github', 'composio-slack'],
      enabledToolIds: ['mcp-github', 'composio-slack'],
      executorMap: { 'composio-slack': 'client' as any, 'mcp-github': 'client' as any },
      manifestMap: {
        'composio-slack': { api: [], identifier: 'composio-slack', type: 'default' } as any,
        'mcp-github': { api: [], identifier: 'mcp-github', type: 'default' } as any,
      },
      sourceMap: { 'composio-slack': 'composio', 'mcp-github': 'plugin' } as any,
      tools: [
        { function: { name: 'mcp-github____createIssue' }, type: 'function' },
        { function: { name: 'composio-slack____sendMessage' }, type: 'function' },
      ],
    };

    applyShareGateToToolSet(toolSet, gate);

    // Governed purely by the owner's `enabledToolIds` — never stripped for
    // "not being a known builtin," and never exempted from that owner check
    // either (see the `filterPluginsByShareGate` suite above for the
    // unconfigured/empty-whitelist case).
    expect(toolSet.enabledToolIds).toEqual(['mcp-github', 'composio-slack']);
    expect(toolSet.manifestMap).toEqual({
      'composio-slack': { api: [], identifier: 'composio-slack', type: 'default' },
      'mcp-github': { api: [], identifier: 'mcp-github', type: 'default' },
    });
  });

  it('never blocks a non-builtin identifier at dispatch time, regardless of the share permissions granted', () => {
    expect(isShareBlockedDataToolCall({}, 'mcp-github', 'createIssue')).toBe(false);
    expect(isShareBlockedDataToolCall({}, 'composio-slack', 'sendMessage')).toBe(false);
  });
});
