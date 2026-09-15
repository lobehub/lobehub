import { SolverManifest } from '@lobechat/builtin-tool-solver';
import {
  SolverExecutionRuntime,
  SolverServiceClient,
} from '@lobechat/builtin-tool-solver/executionRuntime';

import { toolsEnv } from '@/envs/tools';

import { type ServerRuntimeRegistration } from './types';

/**
 * Server runtime for the builtin-solver builtin tool: executes against the
 * deployed solver service over HTTP with bearer auth (the service is hosted outside this repo).
 *
 * The tool is only offered to agents when both env vars are set — the gate
 * lives in `AgentToolsEngine` (physical manifest drop + enable rule) with a
 * client mirror driven by `enableSolverService` in the server config. The
 * client constructor still validates config so a misconfigured deployment
 * fails with a clear, key-free error instead of an opaque fetch failure.
 */
export const solverRuntime: ServerRuntimeRegistration = {
  factory: () =>
    new SolverExecutionRuntime(
      new SolverServiceClient({
        apiKey: toolsEnv.SOLVER_SERVICE_API_KEY!,
        baseUrl: toolsEnv.SOLVER_SERVICE_URL!,
      }),
    ),
  identifier: SolverManifest.identifier,
};
