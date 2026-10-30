import type { ExecAgentResult } from '@lobechat/types';
import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { signUserJWT } from '@/libs/trpc/utils/internalJwt';
import { spawnHeteroSandbox } from '@/server/services/heterogeneousAgent/sandboxRunner';

import {
  getHeterogeneousAgentTitle,
  supportsCloudHeterogeneousSandbox,
} from '../../helpers/heteroErrors';
import { finalizeHeteroDispatchError } from '../finalizeHeteroDispatchError';
import type { PreparedHeteroRun } from './prepare';
import type { HeteroDispatchDeps, HeteroDispatchInput, HeteroRun } from './types';
import { failHeteroDispatch } from './utils';

const log = debug('lobe-server:ai-agent-service');

/**
 * Liveness probe for the ONE dispatch failure that races a live run: the cloud
 * sandbox `runCommand` call (see the `spawnHeteroSandbox` catch in `spawnInCloudSandbox`). Every
 * other `finalizeHeteroDispatchError` caller rejects synchronously, before any
 * agent process can exist, so none of them needs this.
 *
 * `runCommand` is issued with `background: true` and is supposed to return as
 * soon as the command is handed to the sandbox — but the sandbox gateway can
 * sit on the connection and answer `Gateway Timeout` a minute or more later,
 * long after the sandbox actually booted and started streaming events back
 * through `heteroIngest`. Finalizing on that rejection blindly treats a
 * transient gateway 504 as "the run never started": it blanks the assistant
 * message, stamps an error bubble on a turn the user already read, marks the
 * op row + its task failed, and closes the UI stream out from under a run that
 * is still producing output.
 *
 * Two cheap reads tell a stranded dispatch apart from a live one:
 *
 * 1. `agent_operations.status` — anything other than `running` means the run
 *    reached `heteroFinish` (or a park) on its own. Nothing left to finalize.
 * 2. `topics.metadata.heteroCurrentMsgId` — the ingest path repoints this at
 *    every assistant turn it persists, scoped by `operationId`. It naming THIS
 *    operation is proof the sandbox is alive and writing.
 *
 * When neither fires the sandbox really never came up and the caller finalizes
 * as before. A run that passes this probe and then dies is not stranded: the
 * agent-gateway inactivity watchdog still reaps it through `finalizeAbandoned`.
 */
const hasHeteroRunStarted = async (
  deps: HeteroDispatchDeps,
  params: { operationId: string; topicId: string },
): Promise<boolean> => {
  const { operationId, topicId } = params;

  try {
    const operation = await new AgentOperationModel(
      deps.db,
      deps.userId,
      deps.workspaceId,
    ).findById(operationId);

    if (operation && operation.status !== 'running') {
      log(
        'hasHeteroRunStarted: op=%s already settled (status=%s) — skipping spawn-failure finalize',
        operationId,
        operation.status,
      );
      return true;
    }

    const topic = await deps.topicModel.findById(topicId);
    if (topic?.metadata?.heteroCurrentMsgId?.operationId === operationId) {
      log(
        'hasHeteroRunStarted: op=%s has ingested turns — skipping spawn-failure finalize',
        operationId,
      );
      return true;
    }

    return false;
  } catch (err) {
    // A probe that cannot read must not swallow a real spawn failure: fall
    // back to the pre-existing behaviour and finalize.
    log(
      'hasHeteroRunStarted: probe failed for op=%s (treating as not started): %O',
      operationId,
      err,
    );
    return false;
  }
};

/**
 * The sandbox rejects a run whose agent credential is unset with prose such as
 * `CLAUDE_CODE_OAUTH_TOKEN 未设置。请先在凭证管理中添加该凭证…`. Pull out only
 * the variable name, and only when the text is about a credential, so an
 * operator-side variable (`E2B_API_KEY is not set`) is never presented to IM
 * members as something they should add under Credentials.
 */
const MISSING_CREDENTIAL =
  /\b([A-Z][\dA-Z]*(?:_[\dA-Z]+)+)\s*(?:未设置|未配置|is not set|is not configured)/;
const MENTIONS_CREDENTIAL = /凭证|credential/i;

const readMissingCredential = (detail: string): string | undefined =>
  MENTIONS_CREDENTIAL.test(detail) ? MISSING_CREDENTIAL.exec(detail)?.[1] : undefined;

/**
 * Spawn a local CLI hetero agent in the cloud sandbox. The spawn is
 * fire-and-forget; its failure is settled in the background unless the run
 * demonstrably started (see `hasHeteroRunStarted`).
 *
 * Returns the terminal error result when the provider cannot run in the cloud
 * sandbox, `undefined` once the spawn was issued.
 */
export const spawnInCloudSandbox = async (
  deps: HeteroDispatchDeps,
  run: HeteroRun,
  params: {
    /** The sender may not use the agent's device, which is why this run landed here. */
    deviceAccessDenied?: boolean;
    heteroType: HeteroDispatchInput['heteroType'];
    prepared: PreparedHeteroRun;
  },
): Promise<ExecAgentResult | undefined> => {
  const { deviceAccessDenied, heteroType, prepared } = params;
  const { heteroExecArgs, heteroParams, sandbox } = prepared;
  const { agentId: resolvedAgentId, assistantMessageId, operationId, topicId } = run;

  if (!supportsCloudHeterogeneousSandbox(heteroType)) {
    const message = `${getHeterogeneousAgentTitle(heteroType)} requires a local or connected device; cloud sandbox execution is not supported.`;
    return failHeteroDispatch(deps, run, { detail: message, message }, { error: message, message });
  }

  // Cloud sandbox path — only for sandbox-provisioned local CLI agents.
  // Remote agents (openclaw / hermes) always require a bound device.
  // The entitlement rides on the trust token; without it the execution
  // plane routes to the ephemeral sandbox whatever the request says.
  const marketService = await deps.getMarketService(
    sandbox?.claim ? { sandboxStorage: sandbox.claim } : undefined,
  );
  // The sandbox authenticates its nested `lh` calls with this JWT. The
  // narrow `hetero-operation` token (used for the device-dispatch path
  // above) is rejected by `oidcAuth`, so CC capabilities that hit
  // user-scoped endpoints — e.g. uploading a `Read`-on-image result to
  // the file store for thumbnail echo — would 401 and silently drop.
  // Mint a user-scoped `cli-sandbox` token instead (still `sub: userId`,
  // ownership-gated on heteroIngest/heteroFinish) with a run-length TTL
  // so it outlives a multi-hour run.
  const sandboxJwt = await signUserJWT(deps.userId, '4h');
  spawnHeteroSandbox({
    ...heteroParams,
    agentType: heteroType as 'claude-code' | 'codex',
    args: heteroExecArgs,
    jwt: sandboxJwt,
    marketService,
    sandbox: sandbox && {
      cwd: sandbox.cwd,
      environment: sandbox.environment,
      // Applied before the agent starts, so it opens on the checkout.
      initialization: sandbox.initialization,
      mode: sandbox.mode,
      // The environment's variables, network access, maintenance command
      // and sources all ride here; dropping it starts the run with none
      // of them, and nothing reports that they were ignored.
      specification: sandbox.specification,
      workingDir: sandbox.workingDir,
    },
    workspaceId: deps.workspaceId,
  }).catch(async (err) => {
    // Fire-and-forget: execAgent has already returned `autoStarted`, and
    // the sandbox never reached the point of calling heteroFinish. Drive
    // the same terminal funnel so the stranded run surfaces an error and
    // its task is marked failed instead of hanging in `running`.
    log('execAgent: hetero sandbox spawn failed: %O', err);

    // ...unless the run is demonstrably alive or already finished. This
    // call is the only dispatch failure that can land AFTER the agent
    // started, so a rejection here is not by itself evidence that nothing
    // ran — see `hasHeteroRunStarted`.
    if (await hasHeteroRunStarted(deps, { operationId, topicId })) return;

    const detail = err instanceof Error ? err.message : String(err);
    const missingCredential = readMissingCredential(detail);
    await finalizeHeteroDispatchError(deps, {
      agentId: resolvedAgentId,
      assistantMessageId,
      detail,
      dispatch: {
        agentType: heteroType,
        ...(deviceAccessDenied && { deviceAccessDenied }),
        ...(missingCredential && { missingCredential }),
        stage: 'sandbox_spawn',
      },
      message: 'Hetero sandbox spawn failed',
      operationId,
      topicId,
    }).catch((finalizeErr) => log('execAgent: sandbox-failure finalize failed: %O', finalizeErr));
  });

  return undefined;
};
