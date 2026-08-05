import { recordUpstashWorkflowEvent } from '@lobechat/observability-otel/modules/upstash-workflow';
import { errorNameFrom } from '@lobechat/utils';
import { Client, type PublishRequest, type PublishResponse, Receiver } from '@upstash/qstash';
import { Client as WorkflowClient, type TriggerOptions } from '@upstash/workflow';
import debug from 'debug';

const log = debug('lobe-server:qstash');

const headers = {
  ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET && {
    'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
  }),
};

const normalizeLabel = (label?: string | string[]): string | undefined =>
  Array.isArray(label) ? label.join(',') : label;

type WorkflowTriggerResponse = { workflowRunId: string };

/**
 * QStash client that records OTEL metrics for outbound JSON publishes.
 *
 * Use when:
 * - Publishing QStash JSON messages from server code
 * - Passing a QStash client into Upstash Workflow `serve()` options
 *
 * Expects:
 * - The base `Client` handles authentication and request serialization
 *
 * Returns:
 * - The same publish response as `@upstash/qstash` `Client.publishJSON`
 */
export class OtelQstashClient extends Client {
  override async publishJSON<
    TBody = unknown,
    TRequest extends PublishRequest<TBody> = PublishRequest<TBody>,
  >(request: TRequest): Promise<PublishResponse<TRequest>> {
    try {
      const response = await super.publishJSON(request);
      recordUpstashWorkflowEvent({
        interface: 'qstash',
        label: normalizeLabel(request.label),
        operation: 'trigger',
        retries: request.retries,
        retryDelay: request.retryDelay,
        status: 'success',
        url: request.url,
      });

      return response;
    } catch (error) {
      recordUpstashWorkflowEvent({
        errorType: errorNameFrom(error) ?? typeof error,
        interface: 'qstash',
        label: normalizeLabel(request.label),
        operation: 'trigger',
        retries: request.retries,
        retryDelay: request.retryDelay,
        status: 'error',
        url: request.url,
      });

      throw error;
    }
  }
}

/**
 * Upstash Workflow client that records OTEL metrics for outbound triggers.
 *
 * Use when:
 * - Triggering Upstash Workflow runs from app code
 * - Preserving the native workflow client API while adding metrics
 *
 * Expects:
 * - Trigger params are either one workflow trigger or a batch of triggers
 *
 * Returns:
 * - The same trigger response shape as `@upstash/workflow` `Client.trigger`
 */
export class OtelWorkflowClient extends WorkflowClient {
  override trigger(params: TriggerOptions): Promise<WorkflowTriggerResponse>;
  override trigger(params: TriggerOptions[]): Promise<WorkflowTriggerResponse[]>;
  override async trigger(
    params: TriggerOptions | TriggerOptions[],
  ): Promise<WorkflowTriggerResponse | WorkflowTriggerResponse[]> {
    const first = Array.isArray(params) ? params[0] : params;
    const count = Array.isArray(params) ? params.length : 1;

    try {
      const response = Array.isArray(params)
        ? await super.trigger(params)
        : await super.trigger(params);

      recordUpstashWorkflowEvent(
        {
          interface: 'workflow',
          label: first?.label,
          operation: 'trigger',
          retries: first?.retries,
          retryDelay: first?.retryDelay,
          status: 'success',
          url: first?.url,
          workflowRunId: Array.isArray(response)
            ? response[0]?.workflowRunId
            : response.workflowRunId,
        },
        count,
      );

      return response;
    } catch (error) {
      recordUpstashWorkflowEvent(
        {
          errorType: errorNameFrom(error) ?? typeof error,
          interface: 'workflow',
          label: first?.label,
          operation: 'trigger',
          retries: first?.retries,
          retryDelay: first?.retryDelay,
          status: 'error',
          url: first?.url,
          workflowRunId: first?.workflowRunId,
        },
        count,
      );

      throw error;
    }
  }
}

/**
 * QStash client with Vercel Deployment Protection bypass headers.
 * Use as `qstashClient` option in Upstash Workflow `serve()`.
 *
 * @see https://upstash.com/docs/workflow/troubleshooting/vercel
 */
export const qstashClient = new OtelQstashClient({
  headers,
  token: process.env.QSTASH_TOKEN!,
});

/**
 * Workflow client with Vercel Deployment Protection bypass headers.
 * Use for triggering workflows via `workflowClient.trigger()`.
 */
export const workflowClient = new OtelWorkflowClient({
  headers,
  token: process.env.QSTASH_TOKEN!,
});

/**
 * Verify QStash signature using Receiver.
 * Returns true if signing keys are not configured (verification skipped) or signature is valid.
 */
export async function verifyQStashSignature(request: Request, rawBody: string): Promise<boolean> {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;

  if (!currentSigningKey || !nextSigningKey) {
    log('QStash signature verification disabled (no signing keys configured)');
    return false;
  }

  const signature = request.headers.get('Upstash-Signature');
  if (!signature) {
    log('Missing Upstash-Signature header');
    return false;
  }

  const receiver = new Receiver({ currentSigningKey, nextSigningKey });

  try {
    return await receiver.verify({ body: rawBody, signature });
  } catch (error) {
    log('QStash signature verification failed: %O', error);
    return false;
  }
}
