import type { LobeChatDatabase } from '@lobechat/database';
import type { ChannelExecutionConfig } from '@lobechat/types';

/**
 * Optional business hook that adjusts one Channel run of an Agent before it is submitted, for
 * deployments that guide Agents through situations such as their first conversation.
 *
 * Called only for the requester's own Agents: a shared Agent runs under its owner's account, so a
 * visitor's run never gets a preset.
 */
export interface ChannelRunPresetParams {
  /** The Agent that answers. */
  agentId: string;
  db: LobeChatDatabase;
  /** The run's frozen configuration (runtime, model, the Agent's settings at claim time). */
  executionConfig: ChannelExecutionConfig;
  /** The account the run executes as. */
  userId: string;
  workspaceId?: string;
}

export interface ChannelRunPreset {
  /** Appended after the Channel instructions for this run. */
  instructions?: string;
  /**
   * Let the run change its own Agent's configuration (system prompt, name, title) with the agent
   * builder tools. The tools are scoped to the answering Agent; they never reach another one.
   */
  selfConfiguration?: boolean;
}

/** Default: Channel runs are submitted unchanged. */
export const resolveChannelRunPreset = async (
  _params: ChannelRunPresetParams,
): Promise<ChannelRunPreset | undefined> => undefined;
