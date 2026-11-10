import { describe, expect, it } from 'vitest';

import { planFixtureProbes } from '../pipeline/probePlanner';
import { fixtureIds, getStyleFixture, styleFixtureSchema } from './fixtureRegistry';

describe('explicit fixture contract', () => {
  it('splits WorkPreview resource/status cases inside the sixteen-shard budget', () => {
    const resources = getStyleFixture('WorkPreview');
    const statuses = getStyleFixture('WorkPreviewStatus');
    expect(resources.styleVariants).toHaveLength(14);
    expect(statuses.styleVariants).toHaveLength(4);
    expect(planFixtureProbes(resources).length + planFixtureProbes(statuses).length).toBe(108);
    expect(
      getStyleFixture('PreviewToolbar').moduleBoundaries.every(
        (edge) => edge.source !== './PathBreadcrumb',
      ),
    ).toBe(true);
    expect(() =>
      styleFixtureSchema.parse({
        ...resources,
        moduleBoundaries: [
          { importer: 'src/fixture.tsx', source: 'store', replacement: 'fixtures/undeclared.ts' },
        ],
      }),
    ).toThrow('UNDECLARED_BOUNDARY_ASSET');
  });
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

  it('requires unique surfaces and explicitly scoped known portal variants', () => {
    const fixture = getStyleFixture('GeneratingBorder');
    const portal = {
      id: 'popup',
      kind: 'portal',
      selector: '[data-popup]',
      variants: ['generating'],
    };
    expect(
      styleFixtureSchema
        .parse({ ...fixture, surfaces: [...fixture.surfaces, portal] })
        .surfaces.at(-1)?.variants,
    ).toEqual(['generating']);
    expect(() => styleFixtureSchema.parse({ ...fixture, surfaces: [portal, portal] })).toThrow(
      'DUPLICATE_SURFACE_ID',
    );
    for (const variants of [['unknown'], ['generating', 'generating'], []])
      expect(() =>
        styleFixtureSchema.parse({ ...fixture, surfaces: [{ ...portal, variants }] }),
      ).toThrow();
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

  it('connects all entries with explicit mounting and probe contracts', () => {
    expect(fixtureIds).toHaveLength(21);
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
