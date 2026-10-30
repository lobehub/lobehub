import type { StyleFixture } from './fixtureRegistry';

export interface FixtureProbe {
  direction: 'ltr' | 'rtl';
  id: string;
  interaction?: { key: string; state: string; tag: string };
  pseudo: 'default' | 'hover' | 'focus-visible';
  variant: string;
  viewportWidth?: number;
  width: number;
}

/** A finite declared host contract, NOT automatic CSS condition coverage. */
export const planFixtureProbes = (fixture: StyleFixture): FixtureProbe[] => {
  const probes: FixtureProbe[] = [];
  for (const variant of fixture.styleVariants) {
    const states = variant.states ?? ['default' as const];
    for (const direction of ['ltr', 'rtl'] as const)
      for (const width of fixture.probeWidths)
        for (const pseudo of states)
          probes.push({
            direction,
            id: `${variant.id}:${direction}:${width}:${pseudo}`,
            pseudo,
            variant: variant.id,
            width,
          });
  }
  if (probes.length > 256) throw new Error('PROBE_BUDGET_EXCEEDED');
  return probes;
};
