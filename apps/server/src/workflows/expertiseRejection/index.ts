import debug from 'debug';

import { getServerDB } from '@/database/server';
import { appEnv } from '@/envs/app';
import { workflowClient } from '@/libs/qstash';
import { ExpertiseIngestionService } from '@/server/services/expertise/ingestion';

import { runExpertiseRejectionWorkflow } from './run';
import type { ExpertiseRejectionWorkflowPayload } from './types';

const log = debug('lobe-server:workflows:expertise-rejection');

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
