import debug from 'debug';
import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getServerDB } from '@/database/core/db-adaptor';
import { AiAgentService } from '@/server/services/aiAgent';

const log = debug('api-route:agent:exec');

/**
 * Verify QStash signature using Receiver
 * Returns true if verification is disabled or signature is valid
 */
const verifyQStashSignature = async (request: NextRequest, rawBody: string): Promise<boolean> => {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;

  // If no signing keys configured, skip verification
  if (!currentSigningKey || !nextSigningKey) {
    log('QStash signature verification disabled (no signing keys configured)');
    return false;
  }

  const signature = request.headers.get('Upstash-Signature');
  if (!signature) {
    log('Missing Upstash-Signature header');
    return false;
  }

  const { Receiver } = await import('@upstash/qstash');
  const receiver = new Receiver({ currentSigningKey, nextSigningKey: nextSigningKey });

  try {
    return await receiver.verify({ body: rawBody, signature });
  } catch (error) {
    log('QStash signature verification failed: %O', error);
    return false;
  }
};

/**
 * Verify API key from Authorization header
 * Format: Bearer <api_key>
 */
function verifyApiKey(request: NextRequest): boolean {
  const apiKey = process.env.AGENT_EXEC_API_KEY;

  // If no API key configured, skip verification
  if (!apiKey) {
    log('API key verification disabled (AGENT_EXEC_API_KEY not configured)');
    return false;
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    log('Missing or invalid Authorization header');
    return false;
  }

  const providedKey = authHeader.slice(7); // Remove 'Bearer ' prefix
  return providedKey === apiKey;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  // Read raw body for signature verification (must be done before parsing JSON)
  const rawBody = await request.text();

  // Verify authentication - either QStash signature or API key
  const isValidQStash = await verifyQStashSignature(request, rawBody);
  const isValidApiKey = verifyApiKey(request);

  if (!isValidQStash && !isValidApiKey) {
    return NextResponse.json(
      { error: 'Unauthorized - Valid QStash signature or API key required' },
      { status: 401 },
    );
  }

  // Parse body after verification
  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const {
      userId,
      agentId,
      slug,
      prompt,
      appContext,
      autoStart = true,
      existingMessageIds,
    } = body;

    // Validate required parameters
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    if (!agentId && !slug) {
      return NextResponse.json({ error: 'Either agentId or slug is required' }, { status: 400 });
    }

    if (!prompt) {
      return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
    }

    log(`[exec] Starting agent execution for user ${userId}, agent ${agentId || slug}`);

    // Initialize service
    const serverDB = await getServerDB();
    const aiAgentService = new AiAgentService(serverDB, userId);

    // Execute agent
    const result = await aiAgentService.execAgent({
      agentId,
      appContext,
      autoStart,
      existingMessageIds,
      prompt,
      slug,
    });

    const executionTime = Date.now() - startTime;

    log(
      `[exec] Agent execution completed in ${executionTime}ms, operationId: ${result.operationId}`,
    );

    return NextResponse.json({
      ...result,
      executionTime,
    });
  } catch (error: any) {
    const executionTime = Date.now() - startTime;
    console.error('[exec] Error in agent execution: %O', error);

    return NextResponse.json(
      {
        error: error.message,
        executionTime,
      },
      { status: 500 },
    );
  }
}
