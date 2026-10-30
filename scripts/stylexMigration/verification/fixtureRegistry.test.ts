import { describe, expect, it } from 'vitest';

import { fixtureIds, getStyleFixture, styleFixtureSchema } from './fixtureRegistry';
import { planFixtureProbes } from './probePlanner';

describe('explicit fixture contract', () => {
  it('declares real versioned entries and does not claim source-unit coverage', () => {
    const fixture = getStyleFixture('LiteTable');
    expect(fixture.component.base.source).toBe('src/components/LiteTable/index.tsx');
    expect(fixture.styleVariants).toHaveLength(5);
    expect(fixture.fontContract.productionFontsVerified).toBe(false);
    expect(fixture.styleVariants.every((variant) => variant.expectedUnits.length === 0)).toBe(true);
  });
  it('rejects arbitrary render paths and unsupported component adapters', () => {
    expect(() =>
      styleFixtureSchema.parse({ ...getStyleFixture('LiteTable'), render: '../escape.tsx' }),
    ).toThrow();
    expect(() => getStyleFixture('Unknown')).toThrow('FIXTURE_ADAPTER_UNAVAILABLE');
  });
  it('plans explicit breakpoint boundaries, RTL, states and all variants within budget', () => {
    const probes = planFixtureProbes(getStyleFixture('LiteTable'));
    expect(probes).toHaveLength(176);
    expect(new Set(probes.map((probe) => probe.id)).size).toBe(176);
    expect(probes).toContainEqual(
      expect.objectContaining({ direction: 'rtl', pseudo: 'hover', variant: 'wide', width: 799 }),
    );
    expect(
      probes.some(
        (probe) => ['loading', 'empty'].includes(probe.variant) && probe.pseudo !== 'default',
      ),
    ).toBe(false);
  });

  it('connects all fourteen reviewed entries with explicit mounting and probe contracts', () => {
    expect(fixtureIds).toHaveLength(14);
    for (const id of fixtureIds) {
      const fixture = getStyleFixture(id);
      expect(fixture.component.id).toBe(id);
      expect(fixture.render).toBe(`fixtures/${id}Fixture.tsx`);
      expect(fixture.probeWidths.length).toBeGreaterThan(0);
      const probes = planFixtureProbes(fixture);
      expect(probes.length).toBeGreaterThan(0);
      expect(new Set(probes.map((probe) => probe.id)).size).toBe(probes.length);
      if (!fixture.defaultInteractionSelector)
        expect(probes.every((probe) => probe.pseudo === 'default')).toBe(true);
      for (const variant of fixture.styleVariants)
        expect(probes.some((probe) => probe.variant === variant.id)).toBe(true);
    }
    expect(getStyleFixture('FilePathDisplay').component.base.exportName).toBe('FilePathDisplay');
    expect(getStyleFixture('DotsLoading').containerMode).toBe('fixture-wrapper');
    expect(getStyleFixture('TailMarquee').settleFrames).toBe(2);
  });

  it('does not assign LiteTable states or selectors to other components', () => {
    expect(planFixtureProbes(getStyleFixture('DotsLoading'))).toHaveLength(12);
    expect(getStyleFixture('StatusBar').defaultInteractionSelector).toContain('button');
    expect(getStyleFixture('GeneratingBorder').styleVariants.map((entry) => entry.id)).toEqual([
      'resting',
      'generating',
    ]);
  });

  it('rejects ambiguous variants, invalid exports and widths outside the host contract', () => {
    const fixture = getStyleFixture('DotsLoading');
    expect(() =>
      styleFixtureSchema.parse({
        ...fixture,
        styleVariants: [fixture.styleVariants[0], fixture.styleVariants[0]],
      }),
    ).toThrow();
    expect(() =>
      styleFixtureSchema.parse({
        ...fixture,
        component: {
          ...fixture.component,
          base: { ...fixture.component.base, exportName: 'default;invalid()' },
        },
      }),
    ).toThrow();
    expect(() => styleFixtureSchema.parse({ ...fixture, probeWidths: [1] })).toThrow();
    expect(() =>
      styleFixtureSchema.parse({
        ...fixture,
        styleVariants: [{ id: 'normal', expectedUnits: [], states: ['default', 'default'] }],
      }),
    ).toThrow('DUPLICATE_FIXTURE_STATE');
  });
});
