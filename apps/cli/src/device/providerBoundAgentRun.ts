import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import {
  type HeterogeneousProviderBindingRuntime,
  resolveHeterogeneousProviderBinding,
} from '@lobechat/heterogeneous-agents';
import {
  prepareCodexProviderBinding,
  sanitizeCodexProviderBindingArgs,
} from '@lobechat/heterogeneous-agents/codexProviderBinding';
import { ProviderBoundAgentRunSchema } from '@lobechat/heterogeneous-agents/protocol';
import {
  gcHostedProviderBindingProfiles,
  prepareHostedProviderBinding,
} from '@lobechat/heterogeneous-agents/providerBindingHost';

import { createLambdaClient } from '../api/client';
import type { resolveToken } from '../auth/resolveToken';
import { CLI_CONFIG_DIR_NAME } from '../constants/identity';
import { type AgentRunAckResult, spawnHeteroAgentRun } from './agentRun';

/**
 * Normalizes wrapper-encoded Codex overrides before applying a provider binding.
 *
 * Before:
 * - ['--effort', 'low', '--agent-arg=-c', '--agent-arg=model_provider="other"']
 * After:
 * - ['--effort', 'low']
 *
 * The server sends wrapper arguments, whereas the shared Desktop planner accepts
 * native argv. Decode only the native argument channel, sanitize it, then preserve
 * its wrapper encoding so CLI options and native options cannot consume each other.
 */
function sanitizeProviderBoundExecArgs(source: string[]): string[] {
  const wrapper: string[] = [];
  const native: string[] = [];
  for (let index = 0; index < source.length; index++) {
    const arg = source[index];
    if (arg.startsWith('--agent-arg=')) native.push(arg.slice('--agent-arg='.length));
    else if (arg === '--agent-arg' && source[index + 1] !== undefined) native.push(source[++index]);
    else wrapper.push(arg);
  }
  return [
    ...wrapper,
    ...sanitizeCodexProviderBindingArgs(native).map((arg) => `--agent-arg=${arg}`),
  ];
}

/**
 * Resolve a personal provider and spawn Codex with an isolated credential environment.
 *
 * Use when:
 * - The personal gateway connection receives the provider-bound RPC.
 * Expects:
 * - Current connect authentication; never an operation token for provider lookup.
 * Returns:
 * - Spawn acknowledgement after binding validation and private profile preparation.
 *
 * Call stack:
 * bindGatewayClientHandlers (../commands/connect)
 *   -> {@link spawnProviderBoundAgentRun}
 *     -> prepareHostedProviderBinding -> prepareCodexProviderBinding
 *     -> {@link spawnHeteroAgentRun}
 */
export async function spawnProviderBoundAgentRun(
  input: unknown,
  auth: Awaited<ReturnType<typeof resolveToken>>,
  connectionWorkspaceId: string | undefined,
  logger: { error: (message: string) => void; info: (message: string) => void },
): Promise<AgentRunAckResult> {
  // Workspace sockets share the admin auth closure. Reject before querying any
  // personal provider, even if provider ids happen to collide across scopes.
  if (connectionWorkspaceId) throw new Error('Provider binding requires a personal connection.');
  const parsed = ProviderBoundAgentRunSchema.safeParse(input);
  if (!parsed.success) throw new Error('Invalid provider-bound device request.');
  const params = parsed.data;
  let runtime: HeterogeneousProviderBindingRuntime;
  try {
    runtime = await createLambdaClient(auth).aiProvider.getProviderBindingRuntime.mutate({
      id: params.providerBinding.apiConfig.providerId,
    });
  } catch {
    // A transport exception can carry headers/body. Keep credentials out of RPC logs.
    throw new Error('Unable to resolve the personal provider. Check connect authentication.');
  }
  const resolved = resolveHeterogeneousProviderBinding({
    agentType: params.agentType,
    apiConfig: params.providerBinding.apiConfig,
    checkCredentials: true,
    enabledModels: runtime.enabledModels,
    providerEnabled: runtime.enabled,
    runtimeConfig: runtime.runtimeConfig,
  });
  if (resolved.error) throw new Error(`Provider binding unavailable: ${resolved.error.code}`);

  // Separate server/account namespaces prevent identical provider ids on different
  // logins from sharing native sessions or configuration files.
  const account = createHash('sha256').update(`${auth.serverUrl}\0${auth.userId}`).digest('hex');
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  const appStoragePath = path.join(os.homedir(), CLI_CONFIG_DIR_NAME, 'provider-runs', account);
  const binding = await prepareHostedProviderBinding({
    agentType: params.agentType,
    appStoragePath,
    args: sanitizeProviderBoundExecArgs(params.args ?? []),
    driver: { prepareProviderBinding: prepareCodexProviderBinding },
    env,
    reference: params.providerBinding,
    resolution: resolved.resolution,
    // Hash untrusted operation ids before using them as a directory component.
    sessionId: createHash('sha256').update(params.operationId).digest('hex'),
  });
  // Preparation just touched the active profile. Reuse Desktop's retention policy
  // for abandoned profiles without delaying execution or exposing filesystem errors.
  void gcHostedProviderBindingProfiles(appStoragePath).catch(() => {
    logger.error('Provider-binding profile cleanup failed.');
  });
  const resumeSessionId =
    params.providerBinding.resumeBindingKey === binding.bindingKey
      ? params.resumeSessionId
      : undefined;
  try {
    logger.info(
      `Provider-bound run op=${params.operationId} type=codex model=${resolved.resolution.apiConfig.model} resume=${Boolean(resumeSessionId)}`,
    );
    return await spawnHeteroAgentRun(
      {
        ...params,
        args: binding.args,
        cleanup: binding.cleanup,
        preparedEnv: binding.env,
        resumeSessionId,
        // Changing bindings creates a new native session and needs full context.
        systemContext: resumeSessionId
          ? params.systemContext
          : (params.resumeFallbackSystemContext ?? params.systemContext),
        serverUrl: auth.serverUrl,
        sessionBindingKey: binding.bindingKey,
      },
      logger,
    );
  } catch {
    await binding.cleanup();
    throw new Error('Unable to spawn provider-bound Codex.');
  }
}
