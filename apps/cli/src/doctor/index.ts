import { contextChecks } from './checks/context';
import { credentialChecks } from './checks/credentials';
import { deviceChecks } from './checks/device';
import { endpointChecks } from './checks/endpoints';
import { executionChecks } from './checks/execution';
import { runtimeChecks } from './checks/runtime';
import { scopeChecks } from './checks/scope';
import { serverChecks } from './checks/server';
import type { DoctorCheck } from './types';

/**
 * Every check, in the order they run.
 *
 * Order is the diagnosis: each layer is only meaningful once the one above it
 * holds, and the runner uses `dependsOn` to stop reporting derived symptoms
 * once a root cause has been found.
 */
export const ALL_CHECKS: readonly DoctorCheck[] = [
  ...runtimeChecks,
  ...endpointChecks,
  ...credentialChecks,
  ...scopeChecks,
  ...contextChecks,
  ...serverChecks,
  ...deviceChecks,
  ...executionChecks,
];

export { renderCompact, renderReport } from './report';
export { exitCodeFor, runDoctor, summarize } from './runner';
export * from './types';
