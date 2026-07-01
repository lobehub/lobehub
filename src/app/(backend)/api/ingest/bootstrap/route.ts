import { BootstrapMetricsModel, serverDB } from '@lobechat/database';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import {
  type BootstrapPayload,
  bootstrapPayloadSchema,
  isBodyTooLarge,
  isOriginAllowed,
  parseUA,
} from './helpers';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const IP_BUCKET_MAX = 10_000;

const ipBucket = new Map<string, { count: number; resetAt: number }>();

const evictExpired = (now: number) => {
  for (const [key, val] of ipBucket) {
    if (now >= val.resetAt) ipBucket.delete(key);
  }
};

const isRateLimited = (ip: string): boolean => {
  const now = Date.now();
  const entry = ipBucket.get(ip);

  if (!entry || now >= entry.resetAt) {
    if (ipBucket.size >= IP_BUCKET_MAX) {
      evictExpired(now);
      if (ipBucket.size >= IP_BUCKET_MAX) {
        ipBucket.delete(ipBucket.keys().next().value!);
      }
    }

    ipBucket.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
};

const getClientIp = (req: NextRequest): string => {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
};

export const POST = async (req: NextRequest): Promise<NextResponse> => {
  const origin = req.headers.get('origin');
  if (!isOriginAllowed(origin, req.nextUrl.origin)) {
    return new NextResponse(null, { status: 403 });
  }

  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return new NextResponse(null, { status: 429 });
  }

  let text: string;
  try {
    text = await req.text();
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  if (isBodyTooLarge(text)) {
    return new NextResponse(null, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const result = bootstrapPayloadSchema.safeParse(raw);
  if (!result.success) {
    return new NextResponse(null, { status: 400 });
  }

  const payload: BootstrapPayload = result.data;
  const { browser, os } = parseUA(req.headers.get('user-agent'));
  const country = req.headers.get('x-vercel-ip-country') ?? undefined;
  const model = new BootstrapMetricsModel(serverDB);

  try {
    await model.create({
      anonId: payload.anonId,
      appVersion: payload.appVersion,
      browser: browser ?? undefined,
      cold: payload.cold,
      country,
      isLogin: payload.isLogin,
      os: os ?? undefined,
      platform: payload.platform,
      spans: payload.spans,
      totalMs: payload.totalMs,
      userId: payload.userId,
    });
  } catch (error) {
    console.error('[bootstrap-metrics] failed to persist metric', error);
    return new NextResponse(null, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
};
