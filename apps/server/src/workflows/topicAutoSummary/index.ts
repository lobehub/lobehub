import type { FlowControl } from '@upstash/qstash';
import type { Client } from '@upstash/workflow';

import { appEnv } from '@/envs/app';
import { OtelWorkflowClient } from '@/libs/qstash';

import type { DispatchTopicAutoSummaryPayload, ExecuteTopicAutoSummaryPayload } from './types';

const DISPATCH_PATH = '/api/workflows/topic-auto-summary/dispatch';
const EXECUTE_PATH = '/api/workflows/topic-auto-summary/execute';

const getClient = (): Client => {
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error('QSTASH_TOKEN is required to trigger topic auto-summary workflows');
  const config: ConstructorParameters<typeof Client>[0] = { token };
  if (process.env.QSTASH_URL) (config as Record<string, unknown>).url = process.env.QSTASH_URL;
  return new OtelWorkflowClient(config);
};

const getUrl = (path: string) => {
  const baseUrl = appEnv.INTERNAL_APP_URL || appEnv.APP_URL;
  if (!baseUrl) throw new Error('APP_URL is required to trigger topic auto-summary workflows');
  return new URL(path, baseUrl).toString();
};

export class TopicAutoSummaryWorkflow {
  private static client: Client;

  private static getClient() {
    this.client ??= getClient();
    return this.client;
  }

  static triggerDispatch(payload: DispatchTopicAutoSummaryPayload) {
    return this.getClient().trigger({
      body: payload,
      flowControl: { key: 'topic-auto-summary.dispatch', parallelism: 1 } satisfies FlowControl,
      url: getUrl(DISPATCH_PATH),
    });
  }

  static triggerExecute(payload: ExecuteTopicAutoSummaryPayload) {
    return this.getClient().trigger({
      body: payload,
      flowControl: {
        key: `topic-auto-summary.execute.user.${payload.userId}`,
        parallelism: 2,
      } satisfies FlowControl,
      url: getUrl(EXECUTE_PATH),
    });
  }
}

export type { DispatchTopicAutoSummaryPayload, ExecuteTopicAutoSummaryPayload } from './types';
