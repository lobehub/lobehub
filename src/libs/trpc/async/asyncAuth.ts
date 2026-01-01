import { type LobeChatDatabase } from '@lobechat/database';
import { TRPCError } from '@trpc/server';
import debug from 'debug';

import { UserModel } from '@/database/models/user';
import { validateInternalJWT } from '@/libs/trpc/utils/internalJwt';

import { asyncTrpc } from './init';

const log = debug('lobe-async:auth');

export const asyncAuth = asyncTrpc.middleware(async (opts) => {
  const { ctx } = opts;

  log('Async auth middleware called for userId: %s', ctx.userId);

  // Validate JWT token to verify request is from lambda
  if (!ctx.authorizationToken) {
    log('Async auth failed - missing authorization token');
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  log('Validating internal JWT token');
  const isValid = await validateInternalJWT(ctx.authorizationToken);
  if (!isValid) {
    log('JWT validation failed');
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid JWT token' });
  }
  log('JWT validation successful');

  if (!ctx.userId) {
    log('Async auth failed - missing userId');
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  try {
    log('Looking up user in database: %s', ctx.userId);
    const result = await UserModel.findById(ctx.serverDB as LobeChatDatabase, ctx.userId);

    if (!result) {
      log('User not found in database: %s', ctx.userId);
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'user is invalid' });
    }

    log('User authentication successful: %s', ctx.userId);
    log('Passing jwtPayload keys: %O', Object.keys(ctx.jwtPayload || {}));

    return opts.next({
      ctx: {
        jwtPayload: ctx.jwtPayload,
        userId: ctx.userId,
      },
    });
  } catch (error) {
    log('Database error during user lookup: %O', error);
    throw error;
  }
});
