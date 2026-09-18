import { type BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  SolveParams,
  SolveServiceResponse,
  SolveState,
  VerifyParams,
  VerifyServiceResponse,
  VerifyState,
} from '../types';
import { type SolveRequestBody, SolverServiceError, type VerifyRequestBody } from './client';
import { formatSolveContent, formatVerifyContent } from './format';

/**
 * Service interface the runtime depends on. `SolverServiceClient` implements
 * it over HTTP; tests inject a mock. Kept minimal on purpose — the runtime
 * owns result shaping (content/state), the service owns transport.
 */
export interface ISolverService {
  solve: (
    pack: string,
    body: SolveRequestBody,
    options?: { signal?: AbortSignal },
  ) => Promise<SolveServiceResponse>;
  verify: (
    pack: string,
    body: VerifyRequestBody,
    options?: { signal?: AbortSignal },
  ) => Promise<VerifyServiceResponse>;
}

/**
 * Solver Execution Runtime — server-side only.
 *
 * All four solve statuses (optimal / feasible_timeout / infeasible / error)
 * are well-formed service answers, so they return `success: true` with the
 * full repair signal in both `content` (for the model) and `state` (for the
 * UI). Only transport failures (auth, network, timeout, 5xx, 413) become
 * `success: false` tool errors — with messages that never include the key.
 */
export class SolverExecutionRuntime {
  private service: ISolverService;

  constructor(service: ISolverService) {
    this.service = service;
  }

  solve = async (args: SolveParams): Promise<BuiltinServerRuntimeOutput> => {
    try {
      const result = await this.service.solve(args.pack, {
        queryId: args.queryId,
        spec: args.spec,
        ...(typeof args.maxCandidates === 'number' ? { maxCandidates: args.maxCandidates } : {}),
        ...(typeof args.timeLimitMs === 'number' ? { timeLimitMs: args.timeLimitMs } : {}),
      });

      const state: SolveState = {
        pack: args.pack,
        queryId: args.queryId,
        status: result.status,
        ...(result.candidates ? { candidates: result.candidates } : {}),
        ...(result.conflicts ? { conflicts: result.conflicts } : {}),
        ...(result.error ? { error: result.error } : {}),
        ...(result.solverMeta ? { solverMeta: result.solverMeta } : {}),
      };

      return {
        content: formatSolveContent(args, result),
        state,
        success: true,
      };
    } catch (error) {
      return this.toErrorOutput(error, 'solve');
    }
  };

  verify = async (args: VerifyParams): Promise<BuiltinServerRuntimeOutput> => {
    try {
      const result = await this.service.verify(args.pack, {
        plan: args.plan,
        queryId: args.queryId,
        spec: args.spec,
      });

      const results = result.results ?? [];
      const state: VerifyState = {
        pack: args.pack,
        pass: result.pass,
        passed: results.filter((r) => r.pass).length,
        queryId: args.queryId,
        results,
        total: results.length,
      };

      return {
        content: formatVerifyContent(args, result),
        state,
        success: true,
      };
    } catch (error) {
      return this.toErrorOutput(error, 'verify');
    }
  };

  private toErrorOutput(error: unknown, op: string): BuiltinServerRuntimeOutput {
    if (error instanceof SolverServiceError) {
      return {
        content: error.message,
        error: { message: error.message, type: error.type },
        success: false,
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      content: `Solver ${op} failed: ${message}`,
      error: { message, type: 'service_error' },
      success: false,
    };
  }
}

export type { SolveRequestBody, SolverServiceErrorType, VerifyRequestBody } from './client';
export { SolverServiceClient, SolverServiceError } from './client';
