import { type ChatCompletionErrorPayload, type ModelRuntime } from '@lobechat/model-runtime';
import { AgentRuntimeError } from '@lobechat/model-runtime';
import { context as otContext } from '@lobechat/observability-otel/api';
import { type ClientSecretPayload } from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';
import { getXorPayload } from '@lobechat/utils/server';

import { auth } from '@/auth';
import { getServerDB } from '@/database/core/db-adaptor';
import { type LobeChatDatabase } from '@/database/type';
import { LOBE_CHAT_AUTH_HEADER, LOBE_CHAT_OIDC_AUTH_HEADER, OAUTH_AUTHORIZED } from '@/envs/auth';
import { extractTraceContext, injectActiveTraceHeaders } from '@/libs/observability/traceparent';
import { validateOIDCJWT } from '@/libs/oidc-provider/jwt';
import { createErrorResponse } from '@/utils/errorResponse';

import { checkAuthMethod } from './utils';

type CreateRuntime = (jwtPayload: ClientSecretPayload) => ModelRuntime;
type RequestOptions = { createRuntime?: CreateRuntime; params: Promise<{ provider?: string }> };

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
    if (process.env.NODE_ENV === 'development' && isDebugApi) {
      return handler(clonedReq, {
        ...options,
        jwtPayload: { userId: 'DEV_USER' },
        serverDB,
        userId: 'DEV_USER',
      });
    }

    let jwtPayload: ClientSecretPayload;

    try {
      // get Authorization from header
      const authorization = req.headers.get(LOBE_CHAT_AUTH_HEADER);
      const oauthAuthorized = !!req.headers.get(OAUTH_AUTHORIZED);

      // better auth handler
      const session = await auth.api.getSession({
        headers: req.headers,
      });

      const betterAuthAuthorized = !!session?.user?.id;

      if (!authorization) throw AgentRuntimeError.createError(ChatErrorType.Unauthorized);

      jwtPayload = getXorPayload(authorization);

      const oidcAuthorization = req.headers.get(LOBE_CHAT_OIDC_AUTH_HEADER);
      let isUseOidcAuth = false;
      if (!!oidcAuthorization) {
        const oidc = await validateOIDCJWT(oidcAuthorization);

        isUseOidcAuth = true;

        jwtPayload = {
          ...jwtPayload,
          userId: oidc.userId,
        };
      }

      if (!isUseOidcAuth)
        checkAuthMethod({
          apiKey: jwtPayload.apiKey,
          betterAuthAuthorized,
          nextAuthAuthorized: oauthAuthorized,
        });
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

    const userId = jwtPayload.userId || '';

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
