import type {
  AgentInterventionResponseData,
  AgentStreamEvent,
} from '@lobechat/agent-gateway-client';
import { getCodexApprovalDecisions, isCodexApprovalDecision } from '@lobechat/types';
import { ManagedProcessRegistry } from '@lobechat/utils/managedProcess';
import { isRecord } from '@lobechat/utils/object';

import { createAgentSpawnBridge } from '../spawn/agentSpawnBridge';
import { readCodexSessionModel, resolveCodexInitialModel } from '../spawn/codexModel';
import { buildAgentInput } from '../spawn/input';
import type { SpawnAgentHandle, SpawnAgentOptions } from '../spawn/spawnAgent';
import {
  buildCodexAppServerArgs,
  buildCodexAppServerInput,
  buildCodexAppServerThreadParams,
  getCodexAppServerUnsupportedArgs,
} from './appServerParams';
import { CodexAppServerClient } from './CodexAppServerClient';
import { CodexThreadSession } from './CodexThreadSession';

/** Native Codex process plus operation-scoped approval delivery for remote CLI hosts. */
export interface CodexAgentHandle extends SpawnAgentHandle {
  /** Number of native requests still waiting for their exact UI callback. */
  readonly pendingApprovalCount: number;
  /** Consumes a validated response only for a live intervention in this operation. */
  resolveIntervention: (response: AgentInterventionResponseData) => boolean;
}

/**
 * Runs one device-dispatched turn with the native Codex permission contract.
 *
 * Use when:
 * - A connected device receives an explicit Codex approval preset.
 *
 * Expects:
 * - The wrapper owns the operation identity and selects a saved permission mode.
 * - UI responses arrive through the authenticated intervention channel.
 *
 * Returns:
 * - The ordinary CLI event/exit handle and a one-shot native approval resolver.
 * - Unsupported arguments or permission mismatches fail without exec fallback.
 *
 * Call stack:
 * lh connect -> lh hetero exec
 *   -> {@link createCodexAgentHandle}
 *     -> {@link CodexThreadSession.run}
 *       -> {@link CodexAppServerClient.request}
 */
export const createCodexAgentHandle = async (
  options: SpawnAgentOptions,
): Promise<CodexAgentHandle> => {
  if (!options.codexPermissionMode) throw new Error('A Codex permission preset is required');
  const args = options.extraArgs ?? [];
  const unsupported = getCodexAppServerUnsupportedArgs(args, {
    permissionMode: options.codexPermissionMode,
    resume: !!options.resumeSessionId,
  });
  if (unsupported.length) {
    throw new Error(`Codex app-server cannot preserve these arguments: ${unsupported.join(', ')}`);
  }

  const cwd = options.cwd ?? process.cwd();
  const env = { ...process.env, ...options.env };
  // Reuse the native input/model readers so images, saved models and resume usage
  // retain the same meaning on Desktop and connected devices.
  const inputPlan = await buildAgentInput('codex', options.prompt, options.inputOptions);
  const initialModel = await resolveCodexInitialModel({ args, env });
  const initialCumulativeUsage = options.resumeSessionId
    ? (await readCodexSessionModel(options.resumeSessionId, { env }))?.cumulativeUsage
    : undefined;
  const bridge = createAgentSpawnBridge();
  // A private registry owns only this dispatch, including descendants and reconnect generations.
  const processes = new ManagedProcessRegistry();
  const pending = new Map<string, { apiName: string; arguments: string; toolCallId: string }>();
  let nativeSessionId = options.resumeSessionId;
  const client = new CodexAppServerClient({
    args: buildCodexAppServerArgs(args).slice(0, -1),
    clientVersion: 'lobehub-cli',
    commandPath: options.command ?? 'codex',
    cwd,
    env,
    onSpawn: (child) =>
      processes.register(child, process.platform !== 'win32', { label: options.operationId }),
  });
  const unsubscribeStderr = client.onStderr(bridge.onStderr);
  let interrupted = false;
  const onEvents = (events: AgentStreamEvent[]) => {
    for (const event of events) {
      if (event.type === 'agent_runtime_end' && event.data.reason === 'interrupted')
        interrupted = true;
      const { interventionId, toolCallId } = event.data;
      if (typeof interventionId !== 'string' || typeof toolCallId !== 'string') continue;
      if (
        event.type === 'agent_intervention_request' &&
        typeof event.data.apiName === 'string' &&
        typeof event.data.arguments === 'string'
      ) {
        pending.set(interventionId, {
          apiName: event.data.apiName,
          arguments: event.data.arguments,
          toolCallId,
        });
      }
      if (event.type === 'agent_intervention_response') pending.delete(interventionId);
    }
    bridge.onEvents(events);
  };
  const session = new CodexThreadSession({
    allowExecFallback: false,
    client,
    initialCumulativeUsage,
    initialModel: initialModel?.model,
    initialThreadId: options.resumeSessionId,
    onEvents,
    onPermissionProfile: (profile) => {
      bridge.onStderr(`${JSON.stringify({ operationId: options.operationId, ...profile })}\n`);
    },
    onRuntimeStatus: () => {},
    onSessionId: (id) => {
      nativeSessionId = id;
    },
    sessionId: options.operationId,
    threadParams: buildCodexAppServerThreadParams(
      args,
      cwd,
      initialModel?.model,
      options.codexPermissionMode,
    ),
  });
  const close = async () => {
    session.close();
    client.close();
    // Use the existing tree-aware shutdown to wait for actual exit and kill TERM-ignoring descendants.
    await processes.shutdown(0);
  };
  const attached = bridge.attach({
    close: () => {
      void close().catch((error: unknown) =>
        bridge.onStderr(`Codex shutdown failed: ${String(error)}\n`),
      );
    },
    dispose: async () => {
      try {
        await close();
      } finally {
        unsubscribeStderr();
        pending.clear();
      }
    },
    interrupt: () => {
      // The app-server owns a separate process group. Forward Stop through its
      // protocol, then close that group even when the native interrupt fails.
      void session.interrupt().catch((error: unknown) => {
        bridge.onStderr(`Codex interrupt failed: ${String(error)}\n`);
      });
      void close().catch((error: unknown) =>
        bridge.onStderr(`Codex shutdown failed: ${String(error)}\n`),
      );
    },
    run: () =>
      session.run({
        input: buildCodexAppServerInput(inputPlan),
        onRawMessage: (line) => options.onRawStdout?.(Buffer.from(line)),
        operationId: options.operationId,
      }),
  });
  const { interrupt, kill } = attached;
  // A native interruption (Stop this turn, approval timeout) ends run() normally,
  // but the wrapper must never report it as a clean exit. ACP bridges keep code 0.
  const exit = attached.exit.then((result) =>
    result.code === 0 && interrupted ? { code: 1, signal: null } : result,
  );
  return {
    events: bridge.events,
    exit,
    interrupt,
    kill,
    get pendingApprovalCount() {
      return pending.size;
    },
    get pid() {
      return client.pid;
    },
    get sessionId() {
      return nativeSessionId;
    },
    stderr: bridge.stderr,
    resolveIntervention(response) {
      const { interventionId, toolCallId, resolutionRequestId } = response;
      const request = interventionId ? pending.get(interventionId) : undefined;
      if (response.producerAck || !interventionId || request?.toolCallId !== toolCallId)
        return false;
      const result = isRecord(response.result) ? response.result : {};
      // Durable review returns an opaque option index, never arbitrary native policy.
      // Resolve it against this exact live callback before the bridge validates it.
      const selected = Object.values(result);
      const optionId = selected.length === 1 ? selected[0] : undefined;
      const index =
        typeof optionId === 'string' && /^decision_\d+$/.test(optionId)
          ? Number(optionId.slice('decision_'.length))
          : -1;
      const args: unknown = JSON.parse(request.arguments);
      const decision =
        response.cancelled || optionId === 'cancel_turn'
          ? 'cancel'
          : index >= 0
            ? getCodexApprovalDecisions(request.apiName, isRecord(args) ? args : {})[index]
            : result.decision;
      if (!isCodexApprovalDecision(decision)) return false;
      return session.resolveApproval(options.operationId, interventionId, decision, {
        cancelReason: response.cancelReason,
        cancelled: response.cancelled,
        resolutionRequestId,
      });
    },
  };
};
