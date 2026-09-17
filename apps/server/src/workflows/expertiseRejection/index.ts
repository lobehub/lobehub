import debug from 'debug';

import { getServerDB } from '@/database/server';
import { appEnv } from '@/envs/app';
import { workflowClient } from '@/libs/qstash';
import { ExpertiseIngestionService } from '@/server/services/expertise/ingestion';

import { runExpertiseRejectionWorkflow } from './run';
import type { ExpertiseRejectionWorkflowPayload } from './types';

const log = debug('lobe-server:workflows:expertise-rejection');

/**
 * In-flight local distillations, one chain per reviewer.
 *
 * The queue path buys serialization with `flowControl`; without a queue, two rounds settling at
 * once would each read the lesson catalog before the other writes. They would then both see no
 * bound domain and create a duplicate default, or both distil against the same stale catalog and
 * fork a lesson that should have attached — and the persistence lock, which only serializes the
 * writes, would happily record both. The key matches the queue's so the two modes behave alike.
 */
const localRuns = new Map<string, Promise<void>>();

export class ExpertiseRejectionWorkflow {
  /**
   * Distils one settled acceptance round in the background.
   *
   * Never throws: this rides on the round-attach path, and losing a distillation is a missed
   * lesson, while failing the attach loses the reviewer's round.
   */
  static async trigger(payload: ExpertiseRejectionWorkflowPayload) {
    try {
      if (!appEnv.enableQueueAgentRuntime) {
        const key = `${payload.userId}:${payload.workspaceId ?? 'personal'}`;
        const previous = localRuns.get(key) ?? Promise.resolve();
        // `catch` before chaining: one failed distillation must not cancel the rounds queued
        // behind it, and every branch already logs its own error.
        const current = previous
          .catch(() => undefined)
          .then(async () => {
            const db = await getServerDB();
            const result = await new ExpertiseIngestionService(
              db,
              payload.userId,
              payload.workspaceId,
            ).ingestAcceptanceRound({
              acceptanceId: payload.acceptanceId,
              verifyRunId: payload.verifyRunId,
            });
            log('local ingestion for run %s: %O', payload.verifyRunId, result);
          });

        localRuns.set(key, current);
        void current
          .catch((error) => log('failed to distil run %s: %O', payload.verifyRunId, error))
          .finally(() => localRuns.get(key) === current && localRuns.delete(key));
        return;
      }

      const baseUrl = appEnv.INTERNAL_APP_URL || appEnv.APP_URL;
      if (!baseUrl) throw new Error('INTERNAL_APP_URL or APP_URL is required');
      await workflowClient.trigger({
        body: payload,
        // One distillation at a time per reviewer: two rounds settling together would race on the
        // same domain's `runIndex`, and the row lock would just serialize them anyway.
        flowControl: { key: `expertise-rejection.${payload.userId}`, parallelism: 1 },
        url: new URL('/api/workflows/expertise-rejection/run', baseUrl).toString(),
      });
    } catch (error) {
      log('failed to distil run %s: %O', payload.verifyRunId, error);
    }
  }
}

export { runExpertiseRejectionWorkflow };
export type { ExpertiseRejectionWorkflowPayload };
