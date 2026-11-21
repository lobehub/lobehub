import { buildHeterogeneousPrompt } from '@lobechat/heterogeneous-agents/protocol';
import { toPiRpcPrompt } from '@lobechat/heterogeneous-agents/rpc';
import {
  buildAgentInput,
  buildClaudeSdkUserMessageFromStreamJson,
  buildCodexAppServerInput,
} from '@lobechat/heterogeneous-agents/spawn';

import type { HeterogeneousAgentImageAttachment } from '@/modules/heterogeneousAgent/types';
import { createLogger } from '@/utils/logger';

import type { AgentSession } from './heterogeneousAgentSession';

const logger = createLogger('controllers:HeterogeneousAgentSteer');

export interface SteerSessionParams {
  imageList?: HeterogeneousAgentImageAttachment[];
  /**
   * Names the delivery: the agent reports it back once it reads the message
   * (Claude Code replays it under this uuid, Codex echoes it as the user
   * message's client id). Pi reports no id; its text names it instead.
   */
  messageId: string;
  prompt: string;
  sessionId: string;
}

/**
 * How a steer ended in the main process.
 * - `accepted`: written into the running session; the agent confirms by
 *   reporting the message back (`step_complete { phase: 'user_message' }`).
 * - `rejected`: the session takes no input now (its turn ended, or the turn
 *   cannot be steered); nothing was written, so it can run as the next turn.
 * - `unsupported`: this runtime has no way into a running turn.
 */
export type SteerSessionResult = {
  /**
   * The text the agent received, when it reports a read message by its text
   * (Pi): the prompt transport can expand it (referenced-topic guidance).
   */
  deliveredText?: string;
  status: 'accepted' | 'rejected' | 'unsupported';
};

const accepted: SteerSessionResult = { status: 'accepted' };
const rejected: SteerSessionResult = { status: 'rejected' };
const unsupported: SteerSessionResult = { status: 'unsupported' };

/**
 * Deliver a user message into a session's running turn — the native steer of
 * each runtime: Claude Code (SDK input stream, or a live CLI's stdin, read at
 * its next tool boundary — never `priority: 'now'`, which aborts the running
 * tool), Codex app-server `turn/steer`, Pi `steer`. Runtimes with
 * no such channel (ACP agents, one-shot CLIs) answer `unsupported`.
 *
 * A failure while writing is thrown: the caller cannot tell whether the agent
 * got the message, so it must not send it again on its own.
 */
export const steerAgentSession = async (
  session: AgentSession | undefined,
  params: SteerSessionParams,
  cacheDir: string,
): Promise<SteerSessionResult> => {
  if (!session) return rejected;

  const promptInput = buildHeterogeneousPrompt({
    imageList: params.imageList,
    isNewSession: false,
    prompt: params.prompt,
  });

  if (session.sdkSession) {
    const plan = await buildAgentInput('claude-code', promptInput, { cacheDir });
    const message = buildClaudeSdkUserMessageFromStreamJson(plan.stdin);
    return session.sdkSession.steer(message, params.messageId) ? accepted : rejected;
  }

  if (session.agentType === 'claude-code') {
    const live = session.liveInput;
    if (!live) return session.process ? unsupported : rejected;
    const plan = await buildAgentInput('claude-code', promptInput, { cacheDir });
    return live.send(plan.stdin, params.messageId) ? accepted : rejected;
  }

  if (session.agentType === 'antigravity') {
    const live = session.liveInput;
    if (!live) return session.process ? unsupported : rejected;
    // Antigravity stream-json input accepts text only; reject image steers so
    // they fall back to the next turn instead of terminating the session.
    if (params.imageList?.length) return rejected;
    const plan = await buildAgentInput('antigravity', promptInput, { cacheDir });
    return live.send(plan.stdin, params.messageId) ? accepted : rejected;
  }

  if (session.appServerSession) {
    const plan = await buildAgentInput('codex', promptInput, { cacheDir });
    const outcome = await session.appServerSession.steer(
      buildCodexAppServerInput(plan),
      params.messageId,
    );
    return outcome === 'accepted' ? accepted : rejected;
  }

  if (session.agentType === 'pi') {
    const rpc = session.piRpcSession;
    if (!rpc) return rejected;
    const { images, text } = await toPiRpcPrompt(promptInput, { cacheDir });
    await rpc.steer(text, images);
    return { deliveredText: text, status: 'accepted' };
  }

  logger.debug('No native steer for %s; the message waits for the run to end', session.agentType);
  return unsupported;
};
