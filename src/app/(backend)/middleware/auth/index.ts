import { type ChatCompletionErrorPayload } from '@lobechat/model-runtime';
import { AgentRuntimeError } from '@lobechat/model-runtime';
import { context as otContext } from '@lobechat/observability-otel/api';
import { type ClientSecretPayload } from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';

import { auth } from '@/auth';
import { getServerDB } from '@/database/core/db-adaptor';
import { type LobeChatDatabase } from '@/database/type';
import { LOBE_CHAT_OIDC_AUTH_HEADER } from '@/envs/auth';
import { extractTraceContext, injectActiveTraceHeaders } from '@/libs/observability/traceparent';
import { validateOIDCJWT } from '@/libs/oidc-provider/jwt';
import { createErrorResponse } from '@/utils/errorResponse';

type RequestOptions = { params: Promise<{ provider?: string }> };

export type RequestHandler = (
  req: Request,
  options: RequestOptions & {
    jwtPayload: ClientSecretPayload;
    serverDB: LobeChatDatabase;
    userId: string;
  },
) => Promise<Response>;

export const checkAuth =
  (handler: RequestHandler) => async (req: Request, options: RequestOptions) => {
    // Clone the request to avoid "Response body object should not be disturbed or locked" error
    // in Next.js 16 when the body stream has been consumed by Next.js internal mechanisms
    // This ensures the handler can safely read the request body
    const clonedReq = req.clone();

    // Get serverDB for database access
    const serverDB = await getServerDB();

    // we have a special header to debug the api endpoint in development mode
    const isDebugApi = req.headers.get('lobe-auth-dev-backend-api') === '1';
    const isMockUser = process.env.ENABLE_MOCK_DEV_USER === '1';
    if (process.env.NODE_ENV === 'development' && (isDebugApi || isMockUser)) {
      const mockUserId = process.env.MOCK_DEV_USER_ID || 'DEV_USER';
      return handler(clonedReq, {
        ...options,
        jwtPayload: { userId: mockUserId },
        serverDB,
        userId: mockUserId,
      });
    }

    let userId: string;

    try {
      // OIDC authentication (CLI)
      const oidcAuthorization = req.headers.get(LOBE_CHAT_OIDC_AUTH_HEADER);
      if (oidcAuthorization) {
        const oidc = await validateOIDCJWT(oidcAuthorization);
        userId = oidc.userId;
      } else {
        // Better Auth session authentication (web)
        const session = await auth.api.getSession({
          headers: req.headers,
        });

        if (!session?.user?.id) {
          throw AgentRuntimeError.createError(ChatErrorType.Unauthorized);
        }

        userId = session.user.id;
      }
    } catch (e) {
      const params = await options.params;

      // if the error is not a ChatCompletionErrorPayload, it means the application error
      if (!(e as ChatCompletionErrorPayload).errorType) {
        if ((e as any).code === 'ERR_JWT_EXPIRED')
          return createErrorResponse(ChatErrorType.SystemTimeNotMatchError, e);

        // other issue will be internal server error
        console.error(e);
        return createErrorResponse(ChatErrorType.InternalServerError, {
          error: e,
          provider: params?.provider,
        });
      }

      const {
        errorType = ChatErrorType.InternalServerError,
        error: errorContent,
        ...res
      } = e as ChatCompletionErrorPayload;

      const error = errorContent || e;

      return createErrorResponse(errorType, { error, ...res, provider: params?.provider });
    }

    const jwtPayload: ClientSecretPayload = { userId };

    const extractedContext = extractTraceContext(req.headers);

    const res = await otContext.with(extractedContext, () =>
      handler(clonedReq, { ...options, jwtPayload, serverDB, userId }),
    );

    // Only inject trace headers when the handler returns a Response
    // NOTICE: this is related to src/app/(backend)/webapi/chat/[provider]/route.test.ts
    if (!(res instanceof Response)) {
      console.warn(
        'Response is not an instance of Response, skipping trace header injection. Possibly bug or mocked response in tests, please check and make sure this is intended behavior.',
      );
      return res;
    }

    try {
      const headers = new Headers(res.headers);
      const traceparent = injectActiveTraceHeaders(headers);
      if (!traceparent) {
        return res;
      }

      return new Response(res.body, { headers, status: res.status, statusText: res.statusText });
    } catch (err) {
      console.error('Failed to inject trace headers:', err);
      return res;
    }
  };
