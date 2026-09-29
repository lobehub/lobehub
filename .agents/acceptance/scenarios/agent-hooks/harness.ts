import type { AgentHook } from '../../../../apps/server/src/services/agentRuntime/hooks/types';
import type { InternalExecAgentParams } from '../../../../apps/server/src/services/aiAgent/types';

export const hookTypes = [
  'beforeStep',
  'afterStep',
  'onComplete',
  'onError',
  'beforeToolCall',
  'afterToolCall',
  'onToolCallError',
  'beforeHumanIntervention',
  'afterHumanIntervention',
  'onStopByHumanIntervention',
  'beforeCompact',
  'afterCompact',
  'onCompactError',
  'beforeCallAgent',
  'afterCallAgent',
  'onCallAgentError',
] as const;

export function notificationHooks(
  receiver: string,
  delivery: 'fetch' | 'qstash' = 'fetch',
  responseFixture = 'observe',
): AgentHook[] {
  return hookTypes.map((type) => ({
    id: `d-${type}`,
    type,
    webhook: { delivery, url: `${receiver}/hooks/${responseFixture}` },
  }));
}

export function controlHook(
  receiver: string,
  scenario: string,
  onError: 'continue' | 'block' = 'continue',
  timeout = 0.2,
): AgentHook {
  return {
    id: `d-control-${scenario}`,
    type: 'beforeToolCall',
    matcher: '^d-fixture/',
    webhook: {
      url: `${receiver}/hooks/${scenario}`,
      responseHandling: 'toolCall',
      onError,
      timeout,
    },
  };
}

/** Real server service seam; caller supplies an isolated DB, fixture user, and seeded Agent. */
export async function runWithHooks<T>(
  service: { execAgent: (params: InternalExecAgentParams) => Promise<T> },
  params: InternalExecAgentParams,
  hooks: AgentHook[],
) {
  return service.execAgent({ ...params, hooks });
}

if (import.meta.main) {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: bun harness.ts <isolated-run.json>');
  const config = (await Bun.file(file).json()) as {
    userId: string;
    receiver: string;
    delivery?: 'fetch' | 'qstash';
    params: InternalExecAgentParams;
    scenario?: string;
    onError?: 'continue' | 'block';
    timeout?: number;
    notificationResponse?: string;
  };
  if (!process.env.DATABASE_URL || !process.env.REDIS_URL)
    throw new Error('Isolated DATABASE_URL and REDIS_URL required');
  const [{ getServerDB }, { AiAgentService }] = await Promise.all([
    import('../../../../packages/database/src/server'),
    import('../../../../apps/server/src/services/aiAgent'),
  ]);
  const service = new AiAgentService(await getServerDB(), config.userId);
  const hooks = notificationHooks(config.receiver, config.delivery, config.notificationResponse);
  if (config.scenario)
    hooks.unshift(controlHook(config.receiver, config.scenario, config.onError, config.timeout));
  const result = await runWithHooks(service, config.params, hooks);
  // Do not print ExecAgentResult: it can contain a gateway auth token.
  console.info(
    JSON.stringify({
      stage: 'execAgent-returned',
      completed: false,
      operationId: result.operationId,
      assistantMessageId: result.assistantMessageId,
      status: result.status,
      success: result.success,
      evidence: 'Inspect persisted operation and receiver log',
    }),
  );
}
