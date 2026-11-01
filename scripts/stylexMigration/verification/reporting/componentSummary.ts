import type { runFixtureComparison } from '../pipeline/componentRunner';

/** Equality is explicitly limited to executed samples, never a gate PASS. */
export const sampledStyleStatus = (
  probes: Array<{
    aaStable: boolean;
    comparison: { differences: readonly unknown[]; review: readonly unknown[] };
    confirmed: boolean;
  }>,
  errors: readonly string[],
  incomplete: boolean,
) => {
  if (errors.length) return 'ERROR';
  if (probes.some((probe) => probe.confirmed && probe.comparison.differences.length))
    return 'DIFFERENT';
  if (!probes.length) return 'NOT_RUN';
  if (probes.some((probe) => !probe.aaStable)) return 'UNSTABLE';
  if (incomplete) return 'INCOMPLETE';
  if (probes.some((probe) => probe.comparison.differences.length || probe.comparison.review.length))
    return 'NEEDS_REVIEW';
  return 'EQUAL_IN_SAMPLES';
};

export const summarizeComponentRun = (
  run: Awaited<ReturnType<typeof runFixtureComparison>>['result'],
) => ({
  aaUnstableProbes: run.results.filter((probe) => !probe.aaStable).length,
  confirmedDifferenceProbes: run.results.filter((probe) => probe.confirmed).length,
  durationMs: run.durationMs,
  timing: run.timing,
  conditionCoverage: run.conditionCoverage,
  conditionCoverageRef: run.conditionCoverageRef,
  executedProbes: run.results.length,
  probeShards: run.probeShards,
  probeShardsRef: run.probeShardsRef,
  ruleCoverage: run.ruleCoverage,
  ruleCoverageRef: run.ruleCoverageRef,
  sampledStyleStatus: sampledStyleStatus(
    run.results,
    run.errors,
    !!run.unexecutedProbeIds.length || !!run.conditionCoverage?.missing,
  ),
  unexecutedProbes: run.unexecutedProbeIds.length,
});
