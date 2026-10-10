// Fixture: the parent reads a setting from its own process env to decide what to ask
// for; the child env never overrides that key (desktop GatewayConnectionCtr, openclaw).
import { spawn } from 'node:child_process';

import { resolveRemotePlatformRuntime } from './remotePlatformRuntime';

export const runOpenclawTurn = async (params: {
  operationId: string;
  platformAgentId?: string;
  prompt: string;
  topicId: string;
}) => {
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    LOBEHUB_OPERATION_ID: params.operationId,
    LOBEHUB_TOPIC_ID: params.topicId,
  };

  const runtime = await resolveRemotePlatformRuntime('openclaw', childEnv);
  if (!runtime.available) throw new Error('OpenClaw executable not found');

  const openclawAgent = params.platformAgentId?.trim() || process.env.OPENCLAW_AGENT_ID || 'main';

  return spawn(runtime.command, ['agent', '--agent', openclawAgent, '--message', params.prompt], {
    env: childEnv,
  });
};
