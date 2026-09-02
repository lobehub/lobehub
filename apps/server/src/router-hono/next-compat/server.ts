import nextServer from 'next/dist/server/web/exports';

import { type AfterTask, getRequestContext, runAfterTask } from './context';

export const {
  ImageResponse,
  NextRequest,
  NextResponse,
  URLPattern,
  userAgent,
  userAgentFromString,
} = nextServer;

export type { NextRequest as NextRequestType, NextResponse as NextResponseType } from 'next/server';

export const connection = async () => {};

export const after = (task: AfterTask): void => {
  const context = getRequestContext();
  if (context) {
    context.afterTasks.push(task);
    return;
  }

  void runAfterTask(task);
};
