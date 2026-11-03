/**
 * This file contains the root router of your tRPC-backend
 */
import { createCallerFactory } from '@/libs/trpc/lambda';
import { lambdaRouter } from '@/server/routers/lambda';

export const createCaller = createCallerFactory(lambdaRouter);
