import { type ChatCompletionErrorPayload } from '@lobechat/model-runtime';
import { AGENT_RUNTIME_ERROR_SET } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { AicoBillingModel } from '@/database/models/aicoBilling';
import { OrganizationModel } from '@/database/models/organization';
import type { LobeChatDatabase } from '@/database/type';
import { createTraceOptions, initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import {
  AICO_BILLING_CONTEXT_HEADER,
  type AicoBillingContext,
  decodeBillingContextHeader,
  parseAicoBillingContext,
} from '@/server/services/aico/billingContext';
import { AicoManagedPolicy, AicoManagedPolicyError } from '@/server/services/aico/managedPolicy';
import { AicoOpenRouterKeyService } from '@/server/services/openrouter/keyService';
import { type ChatStreamPayload } from '@/types/openai/chat';
import { createErrorResponse } from '@/utils/errorResponse';
import { getTracePayload } from '@/utils/trace';

import { resolveValidWorkspaceIdFromRequest } from '../../_utils/workspace';

// If user don't use fluid compute, will build  failed
// this enforce user to enable fluid compute
export const maxDuration = 300;

const resolveBillingContext = (
  req: Request,
  body: ChatStreamPayload & { aicoBilling?: unknown },
): AicoBillingContext => {
  const header = req.headers.get(AICO_BILLING_CONTEXT_HEADER);
  if (header) return decodeBillingContextHeader(header);
  if (body.aicoBilling !== undefined) return parseAicoBillingContext(body.aicoBilling);
  throw new AicoManagedPolicyError('BILLING_CONTEXT_REQUIRED');
};

/**
 * Records a `usage_logs` row against the billing context that actually paid for
 * the request, and pulls the member's authoritative OpenRouter spend so budgets
 * converge without waiting for a dashboard visit.
 */
const recordManagedUsage = async (params: {
  billing: AicoBillingContext;
  db: LobeChatDatabase;
  modelId: string;
  userId: string;
}): Promise<void> => {
  const { billing, db, modelId, userId } = params;

  let orgId: string | null = null;
  let orgMemberId: string | null = null;
  const keyService = new AicoOpenRouterKeyService(db);

  if (billing.source === 'organization') {
    orgId = billing.organizationId;
    const members = await new OrganizationModel(db).listMembers(billing.organizationId);
    const me = members.find((m) => m.userId === userId && m.status === 'active');
    if (me) {
      orgMemberId = me.id;
      await keyService.syncMemberUsage(me.id).catch(() => null);
    }
  } else {
    // Warm personal remaining from OpenRouter so the next sources fetch is current.
    await keyService.getUserRemaining(userId).catch(() => null);
  }

  await new AicoBillingModel(db).recordUsage({
    billingSource: billing.source,
    completionTokens: 0,
    costMicroUsd: 0,
    modelId,
    orgId,
    orgMemberId,
    promptTokens: 0,
    totalTokens: 0,
    userId,
  });
};

export const POST = checkAuth(async (req: Request, { params, userId, serverDB }) => {
  const provider = (await params)!.provider!;

  try {
    const workspaceId = await resolveValidWorkspaceIdFromRequest({ req, serverDB, userId });
    const data = (await req.json()) as ChatStreamPayload & { aicoBilling?: unknown };

    let billingContext: AicoBillingContext | undefined;
    if (AicoManagedPolicy.isManagedProvider(provider)) {
      try {
        billingContext = resolveBillingContext(req, data);
      } catch (error) {
        const code =
          error instanceof Error && error.message.startsWith('BILLING_CONTEXT_')
            ? error.message
            : 'BILLING_CONTEXT_INVALID';
        throw new AicoManagedPolicyError(code);
      }
    }

    // ============  1. init chat model   ============ //
    // For managed providers this is the single policy boundary: `AicoManagedPolicy`
    // resolves the funded wallet/budget, runs the model allow-list check
    // (assertModelAllowed), and injects the managed key — no env/BYOK fallback.
    const modelRuntime = await initModelRuntimeFromDB(serverDB, userId, provider, workspaceId, {
      billingContext,
      modelId: data.model,
    });

    // ============  2. create chat completion   ============ //

    const tracePayload = getTracePayload(req);

    let traceOptions = {};
    // If user enable trace
    if (tracePayload?.enabled) {
      traceOptions = createTraceOptions(data, { provider, trace: tracePayload });
    }

    const response = await modelRuntime.chat(data, {
      user: userId,
      ...traceOptions,
      signal: req.signal,
    });

    if (AicoManagedPolicy.isManagedProvider(provider) && billingContext) {
      // Best-effort and non-blocking: cost stays 0/`pending` until OpenRouter
      // settlement, which is the source of truth for spend.
      void recordManagedUsage({
        billing: billingContext,
        db: serverDB,
        modelId: data.model || provider,
        userId,
      }).catch((err) =>
        console.error(`[aico] post-chat usage recording failed for [${provider}]:`, err),
      );
    }

    return response;
  } catch (e) {
    if (e instanceof AicoManagedPolicyError) {
      return createErrorResponse(e.errorType as any, {
        error: e.code || e.message,
        provider,
      });
    }

    const {
      errorType = ChatErrorType.InternalServerError,
      error: errorContent,
      ...res
    } = e as ChatCompletionErrorPayload;

    const error = errorContent || e;

    // track the error at server side
    if (AGENT_RUNTIME_ERROR_SET.has(errorType as string)) {
      console.warn(`Route: [${provider}] ${errorType}:`, error);
    } else {
      console.error(`Route: [${provider}] ${errorType}:`, error);
    }

    return createErrorResponse(errorType, { error, ...res, provider });
  }
});
