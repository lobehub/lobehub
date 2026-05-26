import { NextResponse } from 'next/server';

import { PushChannel } from '@/server/services/push/PushChannel';

/**
 * Dev-only end-to-end push tester.
 *
 *   POST http://localhost:3010/api/dev/test-push
 *   body: { userId, title?, content?, actionUrl? }
 *
 * Looks up the user's registered Expo tokens via PushTokenModel and triggers
 * a real Expo Push Service send. Use this once EAS credentials are uploaded
 * to verify that the full stack (PushTokenModel → PushChannel → Expo → APNs/FCM
 * → device) works against a real device.
 *
 * Disabled in production builds.
 */
export async function POST(req: Request) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'dev only' }, { status: 404 });
  }

  let body: {
    actionUrl?: string;
    content?: string;
    sessionId?: string;
    title?: string;
    userId?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!body.userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  const channel = new PushChannel();
  try {
    const result = await channel.deliver({
      actionUrl: body.actionUrl,
      content: body.content ?? 'Hello from /api/dev/test-push',
      notificationId: `dev-test-${Date.now()}`,
      title: body.title ?? 'Dev test push',
      userId: body.userId,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message, stack: (error as Error).stack },
      { status: 500 },
    );
  }
}
