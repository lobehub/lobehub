import debug from 'debug';

import { AiProviderModel } from '@/database/models/aiProvider';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import type { HeteroDispatchDeps, HeteroDispatchInput } from './types';

const log = debug('lobe-server:ai-agent-service');

const DSH_AGENT_TYPE = 'deepseek-harness';

export interface OwnDeviceLaunch {
  agentCommand?: string;
  agentEnv?: Record<string, string>;
}

/**
 * How the agent's own config launches the CLI on the requester's own machine:
 * its spawn command and env, plus the requester's DeepSeek key for DeepSeek
 * Harness — what a desktop spawning the agent in-process applies.
 *
 * Only a personal device of the requester receives any of it. On a workspace
 * device the agent's env would let its author set arbitrary variables on
 * another member's machine, and the key would leave the requester's hands.
 * The command and env further need the requester to be able to manage the
 * agent — the people who could set them to anything anyway.
 */
export const resolveOwnDeviceLaunch = async (
  deps: Pick<HeteroDispatchDeps, 'db' | 'userId' | 'workspaceId'>,
  params: {
    canManageAgent: boolean;
    /** Workspace pool the device belongs to; set means a workspace device. */
    deviceWorkspaceId?: string;
    heteroType: HeteroDispatchInput['heteroType'];
    heterogeneousProvider: HeteroDispatchInput['heterogeneousProvider'];
  },
): Promise<OwnDeviceLaunch> => {
  const { canManageAgent, deviceWorkspaceId, heteroType, heterogeneousProvider } = params;
  if (deviceWorkspaceId) return {};

  const ownConfig =
    canManageAgent && heterogeneousProvider?.type === heteroType
      ? heterogeneousProvider
      : undefined;
  const agentCommand = ownConfig?.command?.trim() || undefined;
  const agentEnv: Record<string, string> = { ...ownConfig?.env };

  if (heteroType === DSH_AGENT_TYPE && !agentEnv.DEEPSEEK_API_KEY) {
    const apiKey = await readDeepSeekApiKey(deps);
    if (apiKey) agentEnv.DEEPSEEK_API_KEY = apiKey;
  }

  return {
    ...(agentCommand ? { agentCommand } : {}),
    ...(Object.keys(agentEnv).length > 0 ? { agentEnv } : {}),
  };
};

/** The requester's own DeepSeek key; a failed read launches without it. */
const readDeepSeekApiKey = async (
  deps: Pick<HeteroDispatchDeps, 'db' | 'userId' | 'workspaceId'>,
): Promise<string | undefined> => {
  try {
    const provider = await new AiProviderModel(
      deps.db,
      deps.userId,
      deps.workspaceId,
    ).getAiProviderById('deepseek', KeyVaultsGateKeeper.getUserKeyVaults);
    const apiKey = (provider?.keyVaults as { apiKey?: unknown } | undefined)?.apiKey;
    return typeof apiKey === 'string' && apiKey.trim() ? apiKey : undefined;
  } catch (error) {
    log('execAgent: reading the DeepSeek key for DeepSeek Harness failed: %O', error);
    return undefined;
  }
};
