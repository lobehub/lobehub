import type { LobeChatDatabase } from '@lobechat/database';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { hasActiveWorkspaceMembership } from '@/database/models/workspace';
import { verifyClaudeCodeGatewayJwt } from '@/libs/trpc/utils/internalJwt';

import { resolveClaudeCodeGatewayProvider } from './resolver';

const MAX_REQUEST_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_TOKENS = 128_000;
const OPERATION_POLL_INTERVAL_MS = 1000;

const passthroughRequestHeaders = ['accept', 'anthropic-beta', 'anthropic-version', 'content-type'];
const passthroughResponseHeaders = [
  'content-type',
  'request-id',
  'retry-after',
  'x-request-id',
  'x-ratelimit-limit-requests',
  'x-ratelimit-remaining-requests',
  'x-ratelimit-reset-requests',
];

const readBody = async (request: Request): Promise<{ body: ArrayBuffer; model: string }> => {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_REQUEST_BYTES)
    throw new Error('Claude Code Gateway request is too large');
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_REQUEST_BYTES)
    throw new Error('Claude Code Gateway request is too large');
  const payload = JSON.parse(new TextDecoder().decode(new Uint8Array(body))) as {
    max_tokens?: unknown;
    model?: unknown;
  };
  if (typeof payload.model !== 'string' || !payload.model)
    throw new Error('Request model is required');
  if (
    typeof payload.max_tokens !== 'number' ||
    !Number.isInteger(payload.max_tokens) ||
    payload.max_tokens < 1 ||
    payload.max_tokens > MAX_OUTPUT_TOKENS
  ) {
    throw new Error(`max_tokens must be an integer between 1 and ${MAX_OUTPUT_TOKENS}`);
  }
  return { body, model: payload.model };
};

export class ClaudeCodeGatewayService {
  constructor(private readonly db: LobeChatDatabase) {}

  async handle(request: Request): Promise<Response> {
    const authorization = request.headers.get('authorization');
    const token = authorization?.toLowerCase().startsWith('bearer ')
      ? authorization.slice('bearer '.length).trim()
      : undefined;
    if (!token) return Response.json({ error: 'Missing gateway token' }, { status: 401 });

    let claims: Awaited<ReturnType<typeof verifyClaudeCodeGatewayJwt>>;
    try {
      claims = await verifyClaudeCodeGatewayJwt(token);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid gateway token';
      return Response.json({ error: message }, { status: 401 });
    }

    try {
      const { body, model } = await readBody(request);
      if (!claims.allowedModels.includes(model)) {
        return Response.json(
          { error: 'Model is not authorized for this operation' },
          { status: 403 },
        );
      }
      if (
        claims.workspaceId &&
        !(await hasActiveWorkspaceMembership(this.db, {
          userId: claims.userId,
          workspaceId: claims.workspaceId,
        }))
      ) {
        return Response.json(
          { error: 'Workspace membership is no longer active' },
          { status: 403 },
        );
      }

      const operationModel = new AgentOperationModel(this.db, claims.userId, claims.workspaceId);
      const operation = await operationModel.findById(claims.operationId);
      const snapshot = operation?.metadata?.claudeCodeGateway;
      if (
        operation?.status !== 'running' ||
        !snapshot ||
        snapshot.providerId !== claims.providerId ||
        snapshot.deviceId !== claims.deviceId ||
        snapshot.allowedModels.length !== claims.allowedModels.length ||
        snapshot.allowedModels.some((item) => !claims.allowedModels.includes(item))
      ) {
        return Response.json(
          { error: 'Operation authorization is no longer valid' },
          { status: 403 },
        );
      }

      const provider = await resolveClaudeCodeGatewayProvider({
        db: this.db,
        model,
        providerId: claims.providerId,
        userId: claims.userId,
        workspaceId: claims.workspaceId,
      });
      const headers = new Headers();
      for (const name of passthroughRequestHeaders) {
        const value = request.headers.get(name);
        if (value) headers.set(name, value);
      }
      headers.set('content-type', 'application/json');
      if (new URL(provider.baseURL).hostname === 'api.anthropic.com') {
        headers.set('x-api-key', provider.apiKey);
      } else {
        headers.set('authorization', `Bearer ${provider.apiKey}`);
      }

      const controller = new AbortController();
      const onClientAbort = () => controller.abort(request.signal.reason);
      request.signal.addEventListener('abort', onClientAbort, { once: true });
      const poll = setInterval(async () => {
        try {
          const current = await operationModel.findById(claims.operationId);
          if (current?.status !== 'running') controller.abort('Operation cancelled');
        } catch {
          // The next bounded poll retries. Durable state remains authoritative.
        }
      }, OPERATION_POLL_INTERVAL_MS);

      const cleanup = () => {
        clearInterval(poll);
        request.signal.removeEventListener('abort', onClientAbort);
      };
      const upstream = await fetch(provider.baseURL, {
        body,
        headers,
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
      }).catch((error) => {
        cleanup();
        throw error;
      });
      const responseHeaders = new Headers();
      for (const name of passthroughResponseHeaders) {
        const value = upstream.headers.get(name);
        if (value) responseHeaders.set(name, value);
      }
      if (!upstream.body) cleanup();
      const reader = upstream.body?.getReader();
      const stream = reader
        ? new ReadableStream<Uint8Array>({
            async cancel(reason) {
              controller.abort(reason);
              cleanup();
              await reader.cancel(reason);
            },
            async pull(target) {
              try {
                const chunk = await reader.read();
                if (chunk.done) {
                  cleanup();
                  target.close();
                } else {
                  target.enqueue(chunk.value);
                }
              } catch (error) {
                cleanup();
                target.error(error);
              }
            },
          })
        : null;
      return new Response(stream, {
        headers: responseHeaders,
        status: upstream.status,
        statusText: upstream.statusText,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gateway request failed';
      return Response.json({ error: message }, { status: 400 });
    }
  }
}
