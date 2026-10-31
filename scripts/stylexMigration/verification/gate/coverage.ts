import type { CoverageSummary, GateInput } from '../types';

/** Keys are namespaced by unit: two distinct slots can never close one another. */
export const calculateCoverage = (input: GateInput): CoverageSummary => {
  const fixtures = new Set(input.fixtures.map((fixture) => fixture.id));
  const missingKeys: string[] = [];
  const unresolvedUnitIds: string[] = [];
  let requiredKeys = 0;
  for (const unit of input.units) {
    const witnessed = new Set(
      input.witnesses
        .filter(
          (witness) =>
            witness.unitId === unit.id &&
            unit.fixtureIds.includes(witness.fixtureId) &&
            fixtures.has(witness.fixtureId) &&
            witness.evidenceRefs.length > 0,
        )
        .map((witness) => witness.key),
    );
    const missing = unit.requiredKeys.filter((key) => !witnessed.has(key));
    requiredKeys += unit.requiredKeys.length;
    missingKeys.push(...missing);
    if (!unit.fixtureIds.length || !unit.requiredKeys.length || missing.length)
      unresolvedUnitIds.push(unit.id);
  }
  return {
    machineResolvedUnits: input.units.length - unresolvedUnitIds.length,
    missingKeys,
    requiredKeys,
    reviewResolvedUnits: 0,
    totalUnits: input.units.length,
    unresolvedUnitIds,
    witnessedKeys: requiredKeys - missingKeys.length,
  };
};
