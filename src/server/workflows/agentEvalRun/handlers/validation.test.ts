import type { WorkflowContext } from '@upstash/workflow';
import { describe, expect, it, vi } from 'vitest';

import type {
  ExecuteTestCasePayload,
  FinalizeRunPayload,
  PaginateTestCasesPayload,
  ResumeAgentTrajectoryPayload,
  ResumeThreadTrajectoryPayload,
  RunAgentTrajectoryPayload,
  RunThreadTrajectoryPayload,
} from '@/server/workflows/agentEvalRun';

import { executeTestCaseWorkflowHandler } from './executeTestCase';
import { finalizeRunWorkflowHandler } from './finalizeRun';
import { paginateTestCasesWorkflowHandler } from './paginateTestCases';
import { resumeAgentTrajectoryWorkflowHandler } from './resumeAgentTrajectory';
import { resumeThreadTrajectoryWorkflowHandler } from './resumeThreadTrajectory';
import { runAgentTrajectoryWorkflowHandler } from './runAgentTrajectory';
import { runThreadTrajectoryWorkflowHandler } from './runThreadTrajectory';

vi.mock('@/database/models/agentEval', () => ({
  AgentEvalRunModel: vi.fn(),
  AgentEvalRunTopicModel: vi.fn(),
  AgentEvalTestCaseModel: vi.fn(),
}));
vi.mock('@/database/server', () => ({
  getServerDB: vi.fn(),
}));
vi.mock('@/server/services/agentEvalRun', () => ({
  AgentEvalRunService: vi.fn(),
}));
vi.mock('@/server/workflows/agentEvalRun', () => ({
  AgentEvalRunWorkflow: {
    filterTestCasesNeedingExecution: vi.fn(),
    triggerExecuteTestCase: vi.fn(),
    triggerFinalizeRun: vi.fn(),
    triggerPaginateTestCases: vi.fn(),
    triggerRunAgentTrajectory: vi.fn(),
  },
}));

describe('agent eval workflow handlers', () => {
  it('validates execute-test-case payload before side effects', async () => {
    const run = vi.fn();
    const context = {
      requestPayload: undefined,
      run,
    } as unknown as WorkflowContext<ExecuteTestCasePayload>;

    await expect(executeTestCaseWorkflowHandler(context)).resolves.toEqual({
      error: 'Missing runId, testCaseId, or userId',
      success: false,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('validates finalize-run payload before side effects', async () => {
    const run = vi.fn();
    const context = {
      requestPayload: undefined,
      run,
    } as unknown as WorkflowContext<FinalizeRunPayload>;

    await expect(finalizeRunWorkflowHandler(context)).resolves.toEqual({
      error: 'Missing runId or userId',
      success: false,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('validates paginate-test-cases payload before side effects', async () => {
    const run = vi.fn();
    const context = {
      requestPayload: undefined,
      run,
    } as unknown as WorkflowContext<PaginateTestCasesPayload>;

    await expect(paginateTestCasesWorkflowHandler(context)).resolves.toEqual({
      error: 'Missing runId or userId in payload',
      success: false,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('validates resume-agent-trajectory payload before side effects', async () => {
    const run = vi.fn();
    const context = {
      requestPayload: undefined,
      run,
    } as unknown as WorkflowContext<ResumeAgentTrajectoryPayload>;

    await expect(resumeAgentTrajectoryWorkflowHandler(context)).resolves.toEqual({
      error: 'Missing required parameters',
      success: false,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('validates resume-thread-trajectory payload before side effects', async () => {
    const run = vi.fn();
    const context = {
      requestPayload: undefined,
      run,
    } as unknown as WorkflowContext<ResumeThreadTrajectoryPayload>;

    await expect(resumeThreadTrajectoryWorkflowHandler(context)).resolves.toEqual({
      error: 'Missing required parameters',
      success: false,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('validates run-agent-trajectory payload before side effects', async () => {
    const run = vi.fn();
    const context = {
      requestPayload: undefined,
      run,
    } as unknown as WorkflowContext<RunAgentTrajectoryPayload>;

    await expect(runAgentTrajectoryWorkflowHandler(context)).resolves.toEqual({
      error: 'Missing required parameters',
      success: false,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('validates run-thread-trajectory payload before side effects', async () => {
    const run = vi.fn();
    const context = {
      requestPayload: undefined,
      run,
    } as unknown as WorkflowContext<RunThreadTrajectoryPayload>;

    await expect(runThreadTrajectoryWorkflowHandler(context)).resolves.toEqual({
      error: 'Missing required parameters',
      success: false,
    });
    expect(run).not.toHaveBeenCalled();
  });
});
