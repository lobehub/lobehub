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
export const callLambdaMutation = async <T>(
  { accessToken, serverUrl }: LambdaCallContext,
  procedure: string,
  input: unknown,
): Promise<T> => {
  const base = serverUrl.replace(/\/$/, '');

  // Deliberately no workspace header: every Desktop-main lambda call runs
  // under the personal OIDC identity. Provider binding is personal-agent /
  // local-execution only — `selectRuntimeType` rejects API-mode runs for any
  // workspace agent (including the author, who otherwise CAN spawn one
  // in-process) — so a workspace scope must never leak in here.
  const response = await fetch(`${base}/trpc/lambda/${procedure}`, {
    body: JSON.stringify(superjson.serialize(input)),
    headers: {
      'Content-Type': 'application/json',
      'Oidc-Auth': accessToken,
    },
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
  // Sequential on purpose. Both reads are local (settings store + `safeStorage`
  // decryption), so there is nothing to win by parallelizing — while
  // `Promise.all([auth.getServerUrl(), auth.getAccessToken()])` is a trap: the
  // argument list is evaluated first, so a callback that throws *synchronously*
  // abandons the array before `Promise.all` ever subscribes to its sibling,
  // orphaning that rejection. In Electron main an unhandled rejection is fatal
  // (`process-error-handlers` re-throws it), so an injected-callback bug would
  // kill the app instead of degrading to "no image upload".
  const serverUrl = await auth.getServerUrl();
  const accessToken = await auth.getAccessToken();

  if (!serverUrl || !accessToken) {
    logger.debug('No authed remote server — skipping tool_result image upload');
    return undefined;
  }

  const ctx: LambdaCallContext = { accessToken, serverUrl };

  return {
    checkFileHash: (input) => callLambdaMutation(ctx, 'file.checkFileHash', input),
    createFile: (input) => callLambdaMutation(ctx, 'file.createFile', input),
    createS3PreSignedUrl: (input) => callLambdaMutation(ctx, 'upload.createS3PreSignedUrl', input),
  };
};
