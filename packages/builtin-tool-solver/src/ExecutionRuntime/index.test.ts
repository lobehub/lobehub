import { describe, expect, it, vi } from 'vitest';

import type { SolveServiceResponse, VerifyServiceResponse } from '../types';
import { type ISolverService, SolverExecutionRuntime, SolverServiceError } from './index';

const solveArgs = {
  pack: 'travelplanner',
  queryId: 'validation_0',
  spec: {
    budget: 2000,
    days: 3,
    destination: { name: 'Myrtle Beach', type: 'city' },
    origin: 'Washington',
    peopleNumber: 2,
    startDate: '2026-10-10',
    visitingCityNumber: 1,
  },
};

const candidate = {
  costBreakdown: { accommodation: 314, meals: 220, total: 1234, transportation: 700 },
  plan: [
    {
      accommodation: 'Sea View Hotel, Myrtle Beach',
      attraction: '-',
      breakfast: '-',
      current_city: 'from Washington to Myrtle Beach',
      days: 1,
      dinner: 'Seafood House, Myrtle Beach',
      lunch: '-',
      transportation: 'Flight Number: F100, from Washington to Myrtle Beach',
    },
  ],
  totalCost: 1234,
};

const createMockService = (overrides: Partial<ISolverService> = {}): ISolverService => ({
  solve: vi.fn(),
  verify: vi.fn(),
  ...overrides,
});

describe('SolverExecutionRuntime', () => {
  describe('solve', () => {
    it('passes an optimal result through as structured state plus model-readable content', async () => {
      const response: SolveServiceResponse = {
        candidates: [candidate],
        solverMeta: { engine: 'cp-sat', solveMs: 42, timeLimitMs: 30_000 },
        status: 'optimal',
      };
      const service = createMockService({ solve: vi.fn().mockResolvedValue(response) });
      const runtime = new SolverExecutionRuntime(service);

      const result = await runtime.solve(solveArgs);

      expect(service.solve).toHaveBeenCalledWith('travelplanner', {
        queryId: 'validation_0',
        spec: solveArgs.spec,
      });
      expect(result.success).toBe(true);
      expect(result.state?.status).toBe('optimal');
      expect(result.state?.candidates).toHaveLength(1);
      expect(result.state?.solverMeta).toEqual(response.solverMeta);
      expect(result.content).toContain('solve status: optimal');
      expect(result.content).toContain('$1,234');
      expect(result.content).toContain('within budget $2,000');
      // the plan must be in the content — the model reads content, not state
      expect(result.content).toContain('Sea View Hotel');
    });

    it('forwards maxCandidates and timeLimitMs only when provided', async () => {
      const service = createMockService({
        solve: vi.fn().mockResolvedValue({ candidates: [], status: 'optimal' }),
      });
      const runtime = new SolverExecutionRuntime(service);

      await runtime.solve({ ...solveArgs, maxCandidates: 5, timeLimitMs: 10_000 });

      expect(service.solve).toHaveBeenCalledWith('travelplanner', {
        maxCandidates: 5,
        queryId: 'validation_0',
        spec: solveArgs.spec,
        timeLimitMs: 10_000,
      });
    });

    it('marks feasible_timeout as not-proven-optimal in the content', async () => {
      const service = createMockService({
        solve: vi.fn().mockResolvedValue({
          candidates: [candidate],
          solverMeta: { engine: 'cp-sat', solveMs: 30_000, timeLimitMs: 30_000 },
          status: 'feasible_timeout',
        }),
      });
      const runtime = new SolverExecutionRuntime(service);

      const result = await runtime.solve(solveArgs);

      expect(result.success).toBe(true);
      expect(result.state?.status).toBe('feasible_timeout');
      expect(result.content).toContain('feasible_timeout');
      expect(result.content).toContain('optimality is NOT proven');
    });

    it('passes infeasible conflicts through with fields, explanation and relaxations', async () => {
      const service = createMockService({
        solve: vi.fn().mockResolvedValue({
          conflicts: [
            {
              constraint: 'budget',
              explanation: 'minimum feasible plan cost is $2,340, above the $2,000 budget',
              involvedFields: ['budget'],
              suggestedRelaxations: [
                'raise $.budget to at least the minimum feasible plan cost in the explanation',
              ],
            },
          ],
          solverMeta: { engine: 'cp-sat', solveMs: 15, timeLimitMs: 30_000 },
          status: 'infeasible',
        } satisfies SolveServiceResponse),
      });
      const runtime = new SolverExecutionRuntime(service);

      const result = await runtime.solve(solveArgs);

      // infeasible is a well-formed solver answer, not a transport failure
      expect(result.success).toBe(true);
      expect(result.state?.status).toBe('infeasible');
      expect(result.state?.conflicts).toHaveLength(1);
      expect(result.content).toContain('infeasible');
      expect(result.content).toContain('minimum feasible plan cost is $2,340');
      expect(result.content).toContain('$.budget');
      expect(result.content).toContain('suggested relaxations');
      expect(result.content).toContain('3 repair rounds');
    });

    it('treats status=error (spec validation) as a repair signal, not a transport error', async () => {
      const service = createMockService({
        solve: vi.fn().mockResolvedValue({
          error: 'invalid spec: $.days must be <= 14; $.budget is required',
          solverMeta: { engine: 'cp-sat', solveMs: 0, timeLimitMs: 30_000 },
          status: 'error',
        } satisfies SolveServiceResponse),
      });
      const runtime = new SolverExecutionRuntime(service);

      const result = await runtime.solve(solveArgs);

      expect(result.success).toBe(true);
      expect(result.state?.status).toBe('error');
      expect(result.state?.error).toContain('$.days must be <= 14');
      expect(result.content).toContain('spec failed validation');
      expect(result.content).toContain('$.budget is required');
    });

    it('maps a 401 transport failure to a key-free tool error', async () => {
      const apiKey = 'super-secret-test-key';
      const service = createMockService({
        solve: vi
          .fn()
          .mockRejectedValue(
            new SolverServiceError(
              'unauthorized',
              'Solver service rejected the configured credentials — check SOLVER_SERVICE_API_KEY',
              401,
            ),
          ),
      });
      const runtime = new SolverExecutionRuntime(service);

      const result = await runtime.solve(solveArgs);

      expect(result.success).toBe(false);
      expect(result.error).toMatchObject({ type: 'unauthorized' });
      expect(result.content).toContain('rejected the configured credentials');
      expect(JSON.stringify(result)).not.toContain(apiKey);
    });

    it('maps unexpected exceptions to a service_error tool error', async () => {
      const service = createMockService({
        solve: vi.fn().mockRejectedValue(new Error('boom')),
      });
      const runtime = new SolverExecutionRuntime(service);

      const result = await runtime.solve(solveArgs);

      expect(result.success).toBe(false);
      expect(result.error).toMatchObject({ message: 'boom', type: 'service_error' });
      expect(result.content).toContain('boom');
    });
  });

  describe('verify', () => {
    const verifyArgs = {
      pack: 'travelplanner',
      plan: candidate.plan,
      queryId: 'validation_0',
      spec: solveArgs.spec,
    };

    it('reports a passing verification with per-check results', async () => {
      const response: VerifyServiceResponse = {
        pass: true,
        results: [
          { constraint: 'is_valid_budget', detail: 'total $1,234 <= $2,000', pass: true },
          { constraint: 'is_reasonable_visiting_city', pass: true },
        ],
      };
      const service = createMockService({ verify: vi.fn().mockResolvedValue(response) });
      const runtime = new SolverExecutionRuntime(service);

      const result = await runtime.verify(verifyArgs);

      expect(service.verify).toHaveBeenCalledWith('travelplanner', {
        plan: verifyArgs.plan,
        queryId: 'validation_0',
        spec: verifyArgs.spec,
      });
      expect(result.success).toBe(true);
      expect(result.state).toMatchObject({ pass: true, passed: 2, total: 2 });
      expect(result.content).toContain('PASS');
      expect(result.content).toContain('2/2 checks passed');
    });

    it('reports a failing verification with the failed checks and a do-not-present warning', async () => {
      const service = createMockService({
        verify: vi.fn().mockResolvedValue({
          pass: false,
          results: [
            { constraint: 'is_valid_budget', detail: 'total $2,500 > $2,000', pass: false },
            { constraint: 'is_reasonable_visiting_city', pass: true },
          ],
        } satisfies VerifyServiceResponse),
      });
      const runtime = new SolverExecutionRuntime(service);

      const result = await runtime.verify(verifyArgs);

      expect(result.success).toBe(true);
      expect(result.state).toMatchObject({ pass: false, passed: 1, total: 2 });
      expect(result.content).toContain('FAIL');
      expect(result.content).toContain('is_valid_budget');
      expect(result.content).toContain('do NOT present');
    });

    it('maps a timeout to a tool error', async () => {
      const service = createMockService({
        verify: vi
          .fn()
          .mockRejectedValue(
            new SolverServiceError('timeout', 'Solver service did not respond within 60000 ms'),
          ),
      });
      const runtime = new SolverExecutionRuntime(service);

      const result = await runtime.verify(verifyArgs);

      expect(result.success).toBe(false);
      expect(result.error).toMatchObject({ type: 'timeout' });
    });
  });
});
