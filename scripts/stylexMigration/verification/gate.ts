import { calculateCoverage } from './coverage';
import type { GateDecision, MachineStatus } from './types';
import { gateInputSchema } from './types';

export const exitCode = (status: MachineStatus | 'NOT_APPLICABLE') =>
  ({
    ERROR: 3,
    FAIL: 1,
    NEEDS_REVIEW: 2,
    NOT_APPLICABLE: 4,
    PASS: 0,
  })[status];

/** All collection adapters must pass through this reducer. It never approves evidence. */
export const evaluateGate = (value: unknown): GateDecision => {
  const input = gateInputSchema.parse(value);
  const coverage = calculateCoverage(input);
  const errors = [...input.errors];
  const reasons = new Set<string>();
  if (!input.identityVerified) reasons.add('IDENTITY_UNVERIFIED');
  if (!input.fullScope) reasons.add('PARTIAL_SCOPE');
  if (!input.pureStyleMigration) reasons.add('PURE_STYLE_MIGRATION_UNPROVEN');
  if (!input.units.length) reasons.add('EMPTY_SCOPE');
  if (!input.fixtures.length) reasons.add('MISSING_FIXTURE');
  if (coverage.unresolvedUnitIds.length || !coverage.requiredKeys)
    reasons.add('INCOMPLETE_COVERAGE');
  for (const fixture of input.fixtures) {
    if (!fixture.nodeCount || !fixture.comparisons || !fixture.propertyReads)
      errors.push(`EMPTY_CAPTURE:${fixture.id}`);
    if (!fixture.aaStable) reasons.add(`UNSTABLE_FIXTURE:${fixture.id}`);
  }
  for (const unit of input.units) {
    if (unit.fixtureIds.some((id) => !input.fixtures.some((fixture) => fixture.id === id)))
      reasons.add('MISSING_FIXTURE');
  }
  const difference = input.findings.some(
    (finding) => finding.severity === 'difference' && finding.confirmed,
  );
  input.findings.forEach((finding) => reasons.add(finding.reasonCode));
  const status: MachineStatus = errors.length
    ? 'ERROR'
    : difference
      ? 'FAIL'
      : reasons.size
        ? 'NEEDS_REVIEW'
        : 'PASS';
  return {
    coverage,
    errors,
    findings: input.findings,
    gateEligible: status === 'PASS',
    reasonCodes: [...reasons].sort(),
    status,
  };
};
