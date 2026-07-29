import type { FileStorePort } from '@lobechat/heterogeneous-agents/spawn';
import superjson from 'superjson';

import { createLogger } from '@/utils/logger';

const logger = createLogger('modules:heterogeneousAgent:fileStorePort');

export interface RemoteServerAuth {
  getAccessToken: () => Promise<string | null>;
  getServerUrl: () => Promise<string | null>;
}

interface LambdaCallContext {
  accessToken: string;
  serverUrl: string;
}

/**
 * A failing call may carry a superjson `error` envelope, or nothing at all when
 * a proxy answered with HTML — never let extracting the detail mask the failure.
 */
const errorDetail = (payload: { error?: unknown } | undefined, response: Response): string => {
  if (!payload?.error) return response.statusText;

  try {
    const error = superjson.deserialize(payload.error as any) as { message?: string };
    return error?.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
};

/**
 * Call a Lambda tRPC mutation over plain fetch.
 *
 * Electron main has no tRPC client — and can't reuse the renderer's, which
 * reaches the server through the `BackendProxyProtocolManager` custom protocol.
 * The wire shape is tRPC v11's non-batched `httpLink`: POST to
 * `<url>/<procedure>` with the superjson-serialized input as the body, and a
 * `{ result: { data } }` / `{ error }` envelope back, both superjson payloads.
 */
const lambdaMutation = async <T>(
  { accessToken, serverUrl }: LambdaCallContext,
  procedure: string,
  input: unknown,
): Promise<T> => {
  const base = serverUrl.replace(/\/$/, '');

  const response = await fetch(`${base}/trpc/lambda/${procedure}`, {
    body: JSON.stringify(superjson.serialize(input)),
    headers: { 'Content-Type': 'application/json', 'Oidc-Auth': accessToken },
    method: 'POST',
  });

  const payload = (await response.json().catch(() => undefined)) as
    { error?: unknown; result?: { data?: unknown } } | undefined;

  if (!response.ok || !payload || 'error' in payload) {
    throw new Error(
      `trpc ${procedure} failed: ${response.status} ${errorDetail(payload, response)}`,
    );
  }

  return superjson.deserialize(payload.result?.data as any) as T;
};

/**
 * Resolve the file-store port backing the heterogeneous-agent image echo on the
 * desktop's local direct-spawn path.
 *
 * Returns `undefined` when the app has no authed remote server (never signed
 * in, or token decryption failed) — the pipeline then drops the image and keeps
 * the `[Image: …]` placeholder rather than failing the run.
 */
export const createLambdaFileStorePort = async (
  auth: RemoteServerAuth,
): Promise<FileStorePort | undefined> => {
  const [serverUrl, accessToken] = await Promise.all([auth.getServerUrl(), auth.getAccessToken()]);

  if (!serverUrl || !accessToken) {
    logger.debug('No authed remote server — skipping tool_result image upload');
    return undefined;
  }

  const ctx: LambdaCallContext = { accessToken, serverUrl };

  return {
    checkFileHash: (input) => lambdaMutation(ctx, 'file.checkFileHash', input),
    createFile: (input) => lambdaMutation(ctx, 'file.createFile', input),
    createS3PreSignedUrl: (input) => lambdaMutation(ctx, 'upload.createS3PreSignedUrl', input),
  };
};
