import { NextResponse } from 'next/server';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { getServerDBConfig } from '@/config/db';
import { createCallerFactory } from '@/libs/trpc/lambda';
import { lambdaRouter } from '@/server/routers/lambda';

export const runtime = 'nodejs';
export const maxDuration = 300;

const serverDBEnv = getServerDBConfig();

// Custom handler that supports both regular auth and internal service auth
const handler = async (req: Request, { jwtPayload }: { jwtPayload?: any }) => {
  try {
    const body = await req.json();
    const { model, params, options } = body;

    // Create tRPC caller with authentication context
    const createCaller = createCallerFactory(lambdaRouter);

    const caller = createCaller({
      jwtPayload,
      nextAuth: undefined, // WebAPI routes don't have nextAuth session
      userId: jwtPayload?.userId, // Required for userAuth middleware
    });

    // Call ComfyUI service through tRPC
    const result = await caller.comfyui.createImage({
      model,
      options,
      params,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[ComfyUI WebAPI] Error:', error);

    // Extract AgentRuntimeError from TRPCError's cause
    const agentError = error?.cause;

    // If we have an AgentRuntimeError in the cause, return it
    if (agentError && typeof agentError === 'object' && 'errorType' in agentError) {
      // Convert errorType to HTTP status
      let status;
      switch (agentError.errorType) {
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

      // Return the AgentRuntimeError directly for the Provider to handle
      return NextResponse.json(agentError, { status });
    }

    // Fallback for other errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
};

export const POST = async (req: Request) => {
  // Check for internal service authentication (only if KEY_VAULTS_SECRET is set)
  if (serverDBEnv.KEY_VAULTS_SECRET) {
    const authorization = req.headers.get('Authorization');

    // If request has internal service token, bypass regular auth
    if (authorization === `Bearer ${serverDBEnv.KEY_VAULTS_SECRET}`) {
      // Internal service call from ComfyUI provider
      // Pass a system user ID for internal service calls
      return handler(req, { jwtPayload: { userId: 'INTERNAL_SERVICE' } });
    }
  }

  // Otherwise use regular checkAuth
  // ComfyUI doesn't have a provider param, but checkAuth requires it
  return checkAuth(handler)(req, { params: Promise.resolve({ provider: 'comfyui' }) });
};
