import type { ClientSecretPayload } from '@lobechat/types';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { getServerDBConfig } from '@/config/db';
import { createCallerFactory } from '@/libs/trpc/lambda';
import { lambdaRouter } from '@/server/routers/lambda';

const serverDBEnv = getServerDBConfig();

interface ComfyUIHandlerOptions {
  jwtPayload?: ClientSecretPayload;
}

const handleComfyUICreateImage = async (
  request: Request,
  { jwtPayload }: ComfyUIHandlerOptions,
) => {
  try {
    const body = await request.json();
    const { model, params, options } = body;

    const createCaller = createCallerFactory(lambdaRouter);

    const caller = createCaller({
      jwtPayload,
      userId: jwtPayload?.userId,
    });

    const result = await caller.comfyui.createImage({
      model,
      options,
      params,
    });

    return Response.json(result);
  } catch (error) {
    console.error('[ComfyUI WebAPI] Error:', error);

    const agentError =
      error && typeof error === 'object' && 'cause' in error ? error.cause : undefined;

    if (agentError && typeof agentError === 'object' && 'errorType' in agentError) {
      const { errorType } = agentError;
      let status;
      switch (errorType) {
        case 'InvalidProviderAPIKey':
        case 401: {
          status = 401;
          break;
        }
        case 'PermissionDenied':
        case 403: {
          status = 403;
          break;
        }
        case 'ModelNotFound':
        case 404: {
          status = 404;
          break;
        }
        case 'ComfyUIServiceUnavailable':
        case 503: {
          status = 503;
          break;
        }
        default: {
          status = 500;
        }
      }

      return Response.json(agentError, { status });
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: errorMessage }, { status: 500 });
  }
};

export const comfyUICreateImageAPIHandler = async (request: Request) => {
  if (serverDBEnv.KEY_VAULTS_SECRET) {
    const authorization = request.headers.get('Authorization');

    if (authorization === `Bearer ${serverDBEnv.KEY_VAULTS_SECRET}`) {
      return handleComfyUICreateImage(request, { jwtPayload: { userId: 'INTERNAL_SERVICE' } });
    }
  }

  return checkAuth(handleComfyUICreateImage)(request, {
    params: Promise.resolve({ provider: 'comfyui' }),
  });
};
