import debug from 'debug';
import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { AgentCronJobModel } from '@/database/models/agentCronJob';
import { getServerDB } from '@/database/server';
import { appEnv } from '@/envs/app';
import { verifyQStashSignature } from '@/libs/qstash';
import { deleteCronJobSchedule } from '@/server/services/agentCron/qstashSchedule';
import { AiAgentService } from '@/server/services/aiAgent';

const log = debug('api-route:agent:cron-execute');

export async function POST(request: NextRequest) {
  log('Received cron execute request');

  if (!appEnv.isQStashConfigured) {
    log('Skip cron execute: QStash cron is not configured');
    return NextResponse.json({ message: 'QStash cron is not configured', skipped: true });
  }

  const rawBody = await request.text();

  const isValidQStash = await verifyQStashSignature(request, rawBody);

  log('Cron execute auth status: qstash=%s', isValidQStash);

  if (!isValidQStash) {
    log('Reject cron execute: unauthorized request');
    return NextResponse.json(
      { error: 'Unauthorized - Valid QStash signature required' },
      { status: 401 },
    );
  }

  let payload: { jobId?: string };
  try {
    payload = rawBody ? (JSON.parse(rawBody) as { jobId?: string }) : {};
  } catch {
    log('Reject cron execute: invalid JSON body');
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!payload.jobId) {
    log('Reject cron execute: missing jobId');
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }

  log('Cron execute payload jobId=%s', payload.jobId);

  const db = await getServerDB();
  const job = await AgentCronJobModel.findById(db, payload.jobId);

  if (!job) {
    log('Skip cron execute: job not found jobId=%s', payload.jobId);
    return NextResponse.json({ message: 'Cron job not found', success: true });
  }

  if (!job.enabled) {
    log('Skip cron execute: job disabled jobId=%s', job.id);
    return NextResponse.json({ message: 'Cron job disabled', skipped: true, success: true });
  }

  if (job.remainingExecutions !== null && job.remainingExecutions <= 0) {
    log('Skip cron execute: job depleted jobId=%s', job.id);
    await deleteCronJobSchedule(job.id);

    return NextResponse.json({ message: 'Cron job depleted', skipped: true, success: true });
  }

  log('Executing cron job jobId=%s agentId=%s userId=%s', job.id, job.agentId, job.userId);

  const aiAgentService = new AiAgentService(db, job.userId);
  await aiAgentService.execAgent({
    agentId: job.agentId,
    autoStart: true,
    cronJobId: job.id,
    prompt: job.content,
    title: job.name || undefined,
    trigger: 'cron',
  });

  const updated = await AgentCronJobModel.updateExecutionStats(db, job.id);

  if (updated && !updated.enabled) {
    try {
      await deleteCronJobSchedule(job.id);
    } catch (error) {
      log('Failed to delete depleted cron schedule for job %s: %O', job.id, error);
    }
  }

  log('Cron job executed successfully jobId=%s', job.id);

  return NextResponse.json({ executed: true, success: true });
}
