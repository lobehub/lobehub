import debug from 'debug';

import { appEnv } from '@/envs/app';

import { runExpertiseHistoryWorkflow } from './run';
import type {
  ExpertiseHistoryTopicWorkflowPayload,
  ExpertiseHistoryWorkflowPayload,
} from './types';

const log = debug('lobe-server:workflows:expertise-history');
const localRuns = new Map<string, Promise<void>>();

export class ExpertiseHistoryWorkflow {
  static async trigger(payload: ExpertiseHistoryWorkflowPayload) {
    const runId = `expertise-history-${payload.userId}-${payload.agentId}-${Date.now()}`;
    if (!appEnv.enableQueueAgentRuntime) {
      const key = `${payload.userId}:${payload.workspaceId ?? 'personal'}:${payload.agentId}`;
      const previous = localRuns.get(key) ?? Promise.resolve();
      const current = previous
        .catch(() => undefined)
        .then(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
        .then(async () => {
          try {
            const { getServerDB } = await import('@/database/server');
            const { ExpertiseIngestionService } =
              await import('@/server/services/expertise/ingestion');
            const db = await getServerDB();
            await new ExpertiseIngestionService(
              db,
              payload.userId,
              payload.workspaceId,
            ).ingestHistory(payload.agentId);
          } catch (error) {
            log('Local historical ingestion failed error=%O', error);
          }
        });
      localRuns.set(key, current);
      void current.finally(() => localRuns.get(key) === current && localRuns.delete(key));
      return { workflowRunId: `local-${runId}` };
    }

    const baseUrl = appEnv.INTERNAL_APP_URL || appEnv.APP_URL;
    if (!baseUrl) throw new Error('INTERNAL_APP_URL or APP_URL is required');
    const { workflowClient } = await import('@/libs/qstash');
    return workflowClient.trigger({
      body: payload,
      flowControl: {
        key: `expertise-history.${payload.userId}.${payload.agentId}`,
        parallelism: 1,
      },
      url: new URL('/api/workflows/expertise-history/run', baseUrl).toString(),
    });
  }

  static async triggerTopic(payload: ExpertiseHistoryTopicWorkflowPayload) {
    const baseUrl = appEnv.INTERNAL_APP_URL || appEnv.APP_URL;
    if (!baseUrl) throw new Error('INTERNAL_APP_URL or APP_URL is required');
    const { workflowClient } = await import('@/libs/qstash');
    return workflowClient.trigger({
      body: payload,
      flowControl: { key: 'expertise-history-topics', parallelism: 5 },
      url: new URL('/api/workflows/expertise-history/topic', baseUrl).toString(),
    });
  }
}

export { runExpertiseHistoryWorkflow };
export type { ExpertiseHistoryTopicWorkflowPayload, ExpertiseHistoryWorkflowPayload };
