import debug from 'debug';
import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime';
import { AgentRuntimeService } from '@/server/services/agentRuntime';

const log = debug('api-route:agent:execute-step');

/**
 * Verify QStash signature using Receiver
 * Returns true if verification is disabled or signature is valid
 */
async function verifyQStashSignature(request: NextRequest, rawBody: string): Promise<boolean> {
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
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  // Read raw body for signature verification (must be done before parsing JSON)
  const rawBody = await request.text();

  // Verify QStash signature
  const isValidSignature = await verifyQStashSignature(request, rawBody);
  if (!isValidSignature) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // Parse body after verification
  const body = JSON.parse(rawBody);
  try {
    const {
      operationId,
      stepIndex = 0,
      context,
      humanInput,
      approvedToolCall,
      rejectionReason,
    } = body;

    if (!operationId) {
      return NextResponse.json({ error: 'operationId is required' }, { status: 400 });
    }

    log(`[${operationId}] Starting step ${stepIndex}`);

    // Get userId from operation metadata stored in Redis
    const coordinator = new AgentRuntimeCoordinator();
    const metadata = await coordinator.getOperationMetadata(operationId);

    if (!metadata?.userId) {
      log(`[${operationId}] Invalid operation or no userId found`);
      return NextResponse.json({ error: 'Invalid operation or unauthorized' }, { status: 401 });
    }

    // Initialize service with userId from operation metadata
    const serverDB = await getServerDB();
    const agentRuntimeService = new AgentRuntimeService(serverDB, metadata.userId);

    // Execute step using AgentRuntimeService
    const result = await agentRuntimeService.executeStep({
      approvedToolCall,
      context,
      humanInput,
      operationId,
      rejectionReason,
      stepIndex,
    });

    const executionTime = Date.now() - startTime;

    const responseData = {
      completed: result.state.status === 'done',
      error: result.state.status === 'error' ? result.state.error : undefined,
      executionTime,
      nextStepIndex: result.nextStepScheduled ? stepIndex + 1 : undefined,
      nextStepScheduled: result.nextStepScheduled,
      operationId,
      pendingApproval: result.state.pendingToolsCalling,
      pendingPrompt: result.state.pendingHumanPrompt,
      pendingSelect: result.state.pendingHumanSelect,
      status: result.state.status,
      stepIndex,
      success: result.success,
      totalCost: result.state.cost?.total || 0,
      totalSteps: result.state.stepCount,
      waitingForHuman: result.state.status === 'waiting_for_human',
    };

    log(
      `[${operationId}] Step ${stepIndex} completed (${executionTime}ms, status: ${result.state.status})`,
    );

    return NextResponse.json(responseData);
  } catch (error: any) {
    const executionTime = Date.now() - startTime;
    console.error('Error in execution: %O', error);

    return NextResponse.json(
      {
        error: error.message,
        executionTime,
        operationId: body?.operationId,
        stepIndex: body?.stepIndex || 0,
      },
      { status: 500 },
    );
  }
}

/**
 * Health check endpoint
 */
export async function GET() {
  try {
    return NextResponse.json({
      healthy: true,
      message: 'Agent execution service is running',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error.message,
        healthy: false,
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
