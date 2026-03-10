import debug from 'debug';
import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentCronDispatcher } from '@/server/services/agentCronDispatcher';

const log = debug('api-route:agent:cron-dispatch');

const DispatchRequestSchema = z.object({
  dryRun: z.boolean().optional().default(false),
  maxJobsPerTick: z.number().int().positive().optional(),
  now: z.string().datetime().optional(),
});

/**
 * Verify QStash signature using Receiver
 * Returns true only if signature is valid
 */
const verifyQStashSignature = async (request: NextRequest, rawBody: string): Promise<boolean> => {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;

  if (!currentSigningKey || !nextSigningKey) {
    return false;
  }

  const signature = request.headers.get('Upstash-Signature');
  if (!signature) {
    return false;
  }

  const { Receiver } = await import('@upstash/qstash');
  const receiver = new Receiver({ currentSigningKey, nextSigningKey });

  try {
    return await receiver.verify({ body: rawBody, signature });
  } catch {
    return false;
  }
};

/**
 * Verify API key from Authorization header
 * Format: Bearer <api_key>
 */
const verifyApiKey = (request: NextRequest): boolean => {
  const apiKey = process.env.AGENT_CRON_DISPATCH_API_KEY;

  if (!apiKey) {
    log('Dispatch API key verification disabled (AGENT_CRON_DISPATCH_API_KEY not configured)');
    return false;
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return false;
  }

  const providedKey = authHeader.slice(7);

  return providedKey === apiKey;
};

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  const rawBody = await request.text();

  const isValidQStash = await verifyQStashSignature(request, rawBody);
  const isValidApiKey = verifyApiKey(request);

  if (!isValidQStash && !isValidApiKey) {
    return NextResponse.json(
      {
        error: 'Unauthorized - Valid QStash signature or dispatch API key required',
      },
      { status: 401 },
    );
  }

  let parsedInput: z.infer<typeof DispatchRequestSchema>;

  try {
    const body = rawBody ? JSON.parse(rawBody) : {};
    parsedInput = DispatchRequestSchema.parse(body);
  } catch (error) {
    return NextResponse.json(
      {
        details: error instanceof Error ? error.message : String(error),
        error: 'Invalid request body',
      },
      { status: 400 },
    );
  }

  try {
    const serverDB = await getServerDB();

    const dispatcher = new AgentCronDispatcher(serverDB, {
      maxJobsPerTick: parsedInput.maxJobsPerTick,
    });

    const result = await dispatcher.dispatch({
      dryRun: parsedInput.dryRun,
      now: parsedInput.now ? new Date(parsedInput.now) : undefined,
    });

    return NextResponse.json({
      ...result,
      executionTime: Date.now() - startTime,
    });
  } catch (error) {
    return NextResponse.json(
      {
        details: error instanceof Error ? error.message : String(error),
        error: 'Failed to dispatch cron jobs',
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  const hasDispatchApiKey = !!process.env.AGENT_CRON_DISPATCH_API_KEY;
  const hasQStashSigningKey =
    !!process.env.QSTASH_CURRENT_SIGNING_KEY && !!process.env.QSTASH_NEXT_SIGNING_KEY;

  return NextResponse.json({
    auth: {
      apiKey: hasDispatchApiKey,
      qstashSignature: hasQStashSigningKey,
    },
    healthy: true,
    message: 'Agent cron dispatcher endpoint is running',
    timestamp: new Date().toISOString(),
  });
}
