// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { describe, expect, it } from 'vitest';

import { evaluateAndFinalizeRun } from './aggregate';
import * as runModule from './index';
import { AgentEvalRunService, RUN_CREATE_ID_CONFLICT } from './index';

/**
 * Pins the public surface of `@/server/services/agentEvalRun`: the runtime
 * exports callers import and the members an `AgentEvalRunService` exposes. The
 * behavior behind them is covered by `__tests__/`.
 */
describe('agent eval run service public surface', () => {
  it('exports the same runtime names', () => {
    expect(Object.keys(runModule).sort()).toEqual([
      'AgentEvalRunService',
      'RUN_CREATE_ID_CONFLICT',
    ]);
    expect(RUN_CREATE_ID_CONFLICT).toBe('Run id already exists with different create parameters');
  });

  it('exposes the same public methods on the prototype', () => {
    const methods = [
      'abortRun',
      'canResumeTrajectory',
      'checkAndHandleRunTimeout',
      'claimRun',
      'createRun',
      'deleteRun',
      'executeMultiThreadTrajectory',
      'executeResumedThreadTrajectory',
      'executeResumedTrajectory',
      'executeThreadTrajectory',
      'executeTrajectory',
      'executeTrajectoryOnDemand',
      'getAgentDisplayInfo',
      'getResumableCases',
      'getRunDetails',
      'loadTrajectoryData',
      'recordThreadCompletion',
      'recordTrajectoryCompletion',
      'resumeTrajectory',
      'retryErrorCases',
      'retrySingleCase',
    ];
    for (const method of methods)
      expect(typeof AgentEvalRunService.prototype[method as keyof AgentEvalRunService]).toBe(
        'function',
      );
  });

  it('exposes evaluateAndFinalizeRun as the shared aggregate function', () => {
    const service = new AgentEvalRunService({} as LobeChatDatabase, 'user');
    expect(service.evaluateAndFinalizeRun).toBe(evaluateAndFinalizeRun);
  });
});
