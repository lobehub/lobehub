import { isRecord } from '@lobechat/utils/object';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

import type { HeteroOperationJwtClaims } from '@/libs/trpc/utils/internalJwt';

import { requireHeteroModelInvocation } from '../middleware/hetero-operation-auth';
import {
  encodeAnthropicStream,
  invokeServerDefaultModel,
  normalizeAnthropicRequest,
  SERVER_DEFAULT_MODEL_ALIAS,
} from '../services/heterogeneous-direct.service';

const app = new Hono();

app.post('/v1/messages', requireHeteroModelInvocation, async (c) => {
  const request = await c.req.json().catch(() => null);
  if (!isRecord(request)) throw new HTTPException(400, { message: 'Invalid JSON request' });
  if (request.model !== SERVER_DEFAULT_MODEL_ALIAS) {
    throw new HTTPException(400, { message: `model must be ${SERVER_DEFAULT_MODEL_ALIAS}` });
  }
  if (request.stream !== true) {
    throw new HTTPException(400, { message: 'server-default Anthropic requests must stream' });
  }
  const context = c as Context;
  const claims = context.get('heteroOperationClaims') as HeteroOperationJwtClaims;
  if (!claims.provider_id || !claims.model) {
    throw new HTTPException(403, { message: 'Operation token has no server model selection' });
  }
  const workspaceId = context.get('workspaceId');
  const { response } = await invokeServerDefaultModel({
    agentType: 'claude-code',
    model: claims.model,
    payload: normalizeAnthropicRequest(request, SERVER_DEFAULT_MODEL_ALIAS),
    signal: c.req.raw.signal,
    userId: String(context.get('userId')),
    workspaceId: typeof workspaceId === 'string' ? workspaceId : undefined,
  });
  return new Response(encodeAnthropicStream(response.body!), {
    headers: { 'Cache-Control': 'no-cache', 'Content-Type': 'text/event-stream' },
  });
});

export default app;
