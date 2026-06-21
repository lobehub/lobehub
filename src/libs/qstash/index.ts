import { Client, Receiver } from '@upstash/qstash';
import { Client as WorkflowClient } from '@upstash/workflow';
import debug from 'debug';

const log = debug('lobe-server:qstash');

const headers = {
  ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET && {
    'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
  }),
};

function getToken(): string {
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    throw new Error(
      'QSTASH_TOKEN is required. Configure it in your environment variables.',
    );
  }
  return token;
}

/**
 * QStash client with Vercel Deployment Protection bypass headers.
 * Use as `qstashClient` option in Upstash Workflow `serve()`.
 *
 * Lazy-instantiated via Proxy so that missing QSTASH_TOKEN only throws
 * when the client is actually used, not at module import time.
 *
 * @see https://upstash.com/docs/workflow/troubleshooting/vercel
 */
export const qstashClient: Client = new Proxy({} as Client, {
  get(_target, prop) {
    const client = new Client({ headers, token: getToken() });
    return (client as any)[prop];
  },
});

/**
 * Workflow client with Vercel Deployment Protection bypass headers.
 * Use for triggering workflows via `workflowClient.trigger()`.
 *
 * Lazy-instantiated via Proxy so that missing QSTASH_TOKEN only throws
 * when the client is actually used, not at module import time.
 */
export const workflowClient: Client = new Proxy({} as Client, {
  get(_target, prop) {
    const client = new WorkflowClient({ headers, token: getToken() });
    return (client as any)[prop];
  },
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
