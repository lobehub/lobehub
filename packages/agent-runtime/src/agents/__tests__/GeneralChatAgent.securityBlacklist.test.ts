import { type ChatToolPayload } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { type AgentRuntimeContext, type AgentState } from '../../types';
import { GeneralChatAgent } from '../GeneralChatAgent';

/**
 * Sensitive-file security blacklist rules must still pause for human approval
 * in manual / allow-list modes even when a tool uses `file_path`, `items`,
 * `operations`, or `paths` instead of `path` and `pathScopeAudit` considers
 * the target inside the workspace.
 */
describe('GeneralChatAgent — security blacklist on file-path tool arguments', () => {
  const createState = (overrides?: Partial<AgentState>): AgentState => ({
    cost: {
      calculatedAt: new Date().toISOString(),
      currency: 'USD',
      llm: { byModel: [], currency: 'USD', total: 0 },
      tools: { byTool: [], currency: 'USD', total: 0 },
      total: 0,
    },
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
    messages: [],
    operationId: 'test-session',
    plan: { workingDirectory: '/Users/alice/project' },
    status: 'running',
    stepCount: 0,
    toolManifestMap: {
      'lobe-cloud-sandbox': {
        api: [
          {
            humanIntervention: {
              dynamic: { default: 'never', policy: 'always', type: 'cloudSandboxDeleteAudit' },
            },
            name: 'deleteFiles',
          },
          {
            humanIntervention: 'never',
            name: 'moveFiles',
          },
        ],
        identifier: 'lobe-cloud-sandbox',
      },
      'lobe-local-system': {
        api: [
          {
            humanIntervention: {
              dynamic: { default: 'never', policy: 'required', type: 'pathScopeAudit' },
            },
            name: 'editFile',
          },
          {
            humanIntervention: {
              dynamic: { default: 'never', policy: 'required', type: 'pathScopeAudit' },
            },
            name: 'moveFiles',
          },
        ],
        identifier: 'lobe-local-system',
      },
    },
    usage: {
      humanInteraction: {
        approvalRequests: 0,
        promptRequests: 0,
        selectRequests: 0,
        totalWaitingTimeMs: 0,
      },
      llm: { apiCalls: 0, processingTimeMs: 0, tokens: { input: 0, output: 0, total: 0 } },
      tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
    },
    userInterventionConfig: { approvalMode: 'manual' },
    ...overrides,
  });

  const createContext = (toolsCalling: ChatToolPayload[]): AgentRuntimeContext => ({
    payload: { hasToolsCalling: true, parentMessageId: 'msg-1', toolsCalling },
    phase: 'llm_result',
    session: { messageCount: 0, sessionId: 'test-session', status: 'running', stepCount: 0 },
  });

  // Simulates paths inside workingDirectory, where pathScopeAudit returns false (auto-approve).
  const createAgent = () =>
    new GeneralChatAgent({
      agentConfig: { maxSteps: 100 },
      dynamicInterventionAudits: {
        cloudSandboxDeleteAudit: async () => false,
        pathScopeAudit: async () => false,
      },
      modelRuntimeConfig: { model: 'gpt-4o-mini', provider: 'openai' },
      operationId: 'test-session',
    });

  it('requires approval when editFile targets a workspace .env via file_path', async () => {
    const editEnv: ChatToolPayload = {
      apiName: 'editFile',
      arguments: JSON.stringify({
        file_path: '/Users/alice/project/.env',
        new_string: 'API_KEY=leaked',
        old_string: 'API_KEY=secret',
      }),
      id: 'call-edit-env',
      identifier: 'lobe-local-system',
      type: 'builtin',
    };

    const result = await createAgent().runner(createContext([editEnv]), createState());

    expect(result).toEqual([
      {
        parentMessageId: 'msg-1',
        pendingToolsCalling: [editEnv],
        reason: 'human_intervention_required',
        type: 'request_human_approve',
      },
    ]);
  });

  it('requires approval when moveFiles renames or overwrites a workspace .env via items', async () => {
    const renameEnv: ChatToolPayload = {
      apiName: 'moveFiles',
      arguments: JSON.stringify({
        items: [{ newPath: '/Users/alice/project/env.txt', oldPath: '/Users/alice/project/.env' }],
      }),
      id: 'call-move-env',
      identifier: 'lobe-local-system',
      type: 'builtin',
    };

    const overwriteEnv: ChatToolPayload = {
      apiName: 'moveFiles',
      arguments: JSON.stringify({
        items: [{ newPath: '/Users/alice/project/.env', oldPath: '/Users/alice/project/tmp.txt' }],
      }),
      id: 'call-overwrite-env',
      identifier: 'lobe-local-system',
      type: 'builtin',
    };

    expect(await createAgent().runner(createContext([renameEnv]), createState())).toEqual([
      {
        parentMessageId: 'msg-1',
        pendingToolsCalling: [renameEnv],
        reason: 'human_intervention_required',
        type: 'request_human_approve',
      },
    ]);

    expect(await createAgent().runner(createContext([overwriteEnv]), createState())).toEqual([
      {
        parentMessageId: 'msg-1',
        pendingToolsCalling: [overwriteEnv],
        reason: 'human_intervention_required',
        type: 'request_human_approve',
      },
    ]);
  });

  it('requires approval for cloud-sandbox moveFiles operations and deleteFiles paths targeting .env', async () => {
    const sandboxMove: ChatToolPayload = {
      apiName: 'moveFiles',
      arguments: JSON.stringify({
        operations: [{ destination: '/workspace/plain.txt', source: '/workspace/.env' }],
      }),
      id: 'call-sandbox-move',
      identifier: 'lobe-cloud-sandbox',
      type: 'builtin',
    };

    const sandboxDelete: ChatToolPayload = {
      apiName: 'deleteFiles',
      arguments: JSON.stringify({ paths: ['/workspace/.env'] }),
      id: 'call-sandbox-delete',
      identifier: 'lobe-cloud-sandbox',
      type: 'builtin',
    };

    expect(await createAgent().runner(createContext([sandboxMove]), createState())).toEqual([
      {
        parentMessageId: 'msg-1',
        pendingToolsCalling: [sandboxMove],
        reason: 'human_intervention_required',
        type: 'request_human_approve',
      },
    ]);

    expect(await createAgent().runner(createContext([sandboxDelete]), createState())).toEqual([
      {
        parentMessageId: 'msg-1',
        pendingToolsCalling: [sandboxDelete],
        reason: 'human_intervention_required',
        type: 'request_human_approve',
      },
    ]);
  });

  it('still auto-executes editFile on non-sensitive workspace files', async () => {
    const editSafe: ChatToolPayload = {
      apiName: 'editFile',
      arguments: JSON.stringify({
        file_path: '/Users/alice/project/src/app.ts',
        new_string: 'const a = 2;',
        old_string: 'const a = 1;',
      }),
      id: 'call-edit-safe',
      identifier: 'lobe-local-system',
      type: 'builtin',
    };

    const result = await createAgent().runner(createContext([editSafe]), createState());

    expect(result).toEqual([
      { payload: { parentMessageId: 'msg-1', toolCalling: editSafe }, type: 'call_tool' },
    ]);
  });
});
