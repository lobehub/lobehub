import { type NextRequest } from 'next/server';

import { authEnv } from '@/envs/auth';
import {
  handleNativeHandoffIssue,
  handleNativeHandoffTargets,
} from '@/server/services/oidc/nativeHandoffHttp';

const disabled = () => Response.json({ error: 'not_available' }, { status: 404 });

export const GET = (request: NextRequest) =>
  authEnv.ENABLE_OIDC ? handleNativeHandoffTargets(request) : disabled();

export const POST = (request: NextRequest) =>
  authEnv.ENABLE_OIDC ? handleNativeHandoffIssue(request) : disabled();
