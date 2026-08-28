import {
  formatServerDefaultHeterogeneousModel,
  isServerDefaultHeterogeneousModel,
} from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

import type { HeteroOperationJwtClaims } from '@/libs/trpc/utils/internalJwt';

import { requireHeteroModelInvocation } from '../middleware/hetero-operation-auth';
import {
  describeRelayFailure,
  encodeResponsesStream,
  invokeServerDefaultModel,
  normalizeResponsesRequest,
  SERVER_DEFAULT_MODEL_ALIAS,
} from '../services/heterogeneous-direct.service';

const app = new Hono();

app.post('/v1/responses', requireHeteroModelInvocation('openai-responses'), async (c) => {
  const request = await c.req.json().catch(() => null);
  if (!isRecord(request)) throw new HTTPException(400, { message: 'Invalid JSON request' });
  const context = c as Context;
  const claims = context.get('heteroOperationClaims') as HeteroOperationJwtClaims;
  if (!claims.provider_id || !claims.model) {
    throw new HTTPException(403, { message: 'Operation token has no server model selection' });
  }
  if (!isServerDefaultHeterogeneousModel(request.model, claims.model)) {
    throw new HTTPException(400, { message: 'model must match the server operation selection' });
  }
  if (request.stream !== true) {
    throw new HTTPException(400, { message: 'server-default Responses requests must stream' });
  }
  const workspaceId = context.get('workspaceId');
  const agentType = context.get('heteroAgentType');
  const requestModel = formatServerDefaultHeterogeneousModel(claims.model);

  // Same reasoning as the Anthropic relay: an escaping runtime rejection reaches
  // the client as a bodyless 500. See `describeRelayFailure`.
  let body: ReadableStream<Uint8Array> | null;
  try {
    const { response } = await invokeServerDefaultModel({
      agentType,
      model: claims.model,
      payload: normalizeResponsesRequest(request, SERVER_DEFAULT_MODEL_ALIAS),
      signal: c.req.raw.signal,
      userId: String(context.get('userId')),
      workspaceId: typeof workspaceId === 'string' ? workspaceId : undefined,
    });
    body = response.body;
  } catch (error) {
    const { message, status } = describeRelayFailure(error);
    return c.json({ error: { message, type: 'api_error' } }, status);
  }
  if (!body) {
    return c.json({ error: { message: 'Upstream returned no stream', type: 'api_error' } }, 502);
  }
  return new Response(encodeResponsesStream(body, requestModel), {
    headers: { 'Cache-Control': 'no-cache', 'Content-Type': 'text/event-stream' },
  });
});

export default app;
