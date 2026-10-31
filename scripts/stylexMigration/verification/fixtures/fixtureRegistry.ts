import { z } from 'zod';

import type { ScopeInventory } from '../types';

const relativePath = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.split('/').some((part) => ['..', '.', ''].includes(part)),
  );
const identifier = z.string().regex(/^[$A-Z_][\w$]*$/i);
const pseudo = z.enum(['default', 'hover', 'focus-visible']);
export const styleFixtureSchema = z
  .strictObject({
    assets: z.array(relativePath),
    component: z.strictObject({
      base: z.strictObject({ exportName: identifier, source: relativePath }),
      candidate: z.strictObject({ exportName: identifier, source: relativePath }),
      id: identifier,
    }),
    containerMode: z.enum(['component-root', 'fixture-wrapper']).default('fixture-wrapper'),
    defaultInteractionSelector: z.string().min(1).optional(),
    dependencyRoots: z.array(z.string().min(1)).default([]),
    host: relativePath,
    fontContract: z.strictObject({
      family: z.literal('Arial, sans-serif'),
      mode: z.literal('system-font-diagnostic'),
      productionFontsVerified: z.literal(false),
    }),
    id: identifier,
    interactionSelectors: z
      .strictObject({
        'hover': z.string().min(1).optional(),
        'focus-visible': z.string().min(1).optional(),
      })
      .default({}),
    probeWidths: z.array(z.number().finite().positive()).min(1).max(32).default([320, 600, 920]),
    render: relativePath,
    settleFrames: z.union([z.literal(0), z.literal(2)]).default(0),
    sizeContract: z
      .strictObject({
        host: z.tuple([z.number().finite().nonnegative(), z.number().finite().positive()]),
        viewport: z.tuple([z.number().int().positive(), z.number().int().positive()]),
      })
      .refine(({ host, viewport }) => host[0] < host[1] && viewport[0] < viewport[1])
      .optional(),
    styleVariants: z
      .array(
        z.strictObject({
          expectedUnits: z.array(z.string().min(1)),
          id: z.string().min(1),
          states: z.array(pseudo).min(1).optional(),
        }),
      )
      .min(1),
    surfaces: z
      .array(
        z.strictObject({
          id: z.string().min(1),
          kind: z.enum(['component', 'host', 'portal']),
          selector: z.string().min(1),
        }),
      )
      .min(1),
  })
  .superRefine((fixture, context) => {
    if (
      new Set(fixture.styleVariants.map((variant) => variant.id)).size !==
      fixture.styleVariants.length
    )
      context.addIssue({ code: 'custom', message: 'DUPLICATE_FIXTURE_VARIANT' });
    if (new Set(fixture.probeWidths).size !== fixture.probeWidths.length)
      context.addIssue({ code: 'custom', message: 'DUPLICATE_PROBE_WIDTH' });
    if (
      fixture.sizeContract &&
      fixture.probeWidths.some(
        (width) => width < fixture.sizeContract!.host[0] || width > fixture.sizeContract!.host[1],
      )
    )
      context.addIssue({ code: 'custom', message: 'PROBE_OUTSIDE_HOST_CONTRACT' });
    for (const variant of fixture.styleVariants) {
      if (variant.states && new Set(variant.states).size !== variant.states.length)
        context.addIssue({ code: 'custom', message: 'DUPLICATE_FIXTURE_STATE' });
      for (const state of variant.states ?? ['default'])
        if (
          state !== 'default' &&
          !fixture.defaultInteractionSelector &&
          !fixture.interactionSelectors[state]
        )
          context.addIssue({ code: 'custom', message: 'FIXTURE_INTERACTION_TARGET_REQUIRED' });
    }
  });
export type StyleFixture = z.infer<typeof styleFixtureSchema>;

/** Discovery hints only. An experimental render is not a certified source binding. */
export const experimentalFixtures = [
  ['CollapsibleContent', 'src/components/CollapsibleContent/index.tsx'],
  ['CommandLine', 'src/components/CommandLine/index.tsx'],
  ['DotsLoading', 'src/components/DotsLoading/index.tsx'],
  ['FilePathDisplay', 'packages/shared-tool-ui/src/components/FilePathDisplay.tsx'],
  ['GalleyGrid', 'src/components/GalleyGrid/Grid.tsx'],
  ['GeneratingBorder', 'src/components/GeneratingBorder/index.tsx'],
  ['InlineTable', 'src/components/InlineTable/index.tsx'],
  ['LiteTable', 'src/components/LiteTable/index.tsx'],
  ['OptionCard', 'packages/shared-tool-ui/src/components/OptionCard.tsx'],
  ['OptionRow', 'src/features/ChatInput/ControlBar/OptionRow.tsx'],
  ['StatusBar', 'src/components/CodeEditorPane/StatusBar.tsx'],
  ['TailMarquee', 'src/components/TailMarquee/index.tsx'],
  ['UnreadDot', 'src/components/UnreadDot/index.tsx'],
  ['VersionTag', 'src/components/ChangelogModal/VersionTag.tsx'],
] as const;

export const fixtureIds = experimentalFixtures.map(([id]) => id);
const interactive = ['default', 'hover', 'focus-visible'] as const;
const profiles: Record<
  string,
  {
    dependencies?: string[];
    i18n?: boolean;
    selector?: string;
    selectors?: { 'hover'?: string; 'focus-visible'?: string };
    settleFrames?: 2;
    variants: Array<{ id: string; states?: readonly (typeof interactive)[number][] }>;
  }
> = {
  CollapsibleContent: {
    dependencies: ['lucide-react', 'i18next', 'react-i18next'],
    i18n: true,
    selector: '[data-component-mount] button',
    settleFrames: 2,
    variants: [
      { id: 'collapsed', states: interactive },
      { id: 'expanded', states: interactive },
      { id: 'short' },
    ],
  },
  CommandLine: { variants: [{ id: 'normal' }, { id: 'long' }] },
  DotsLoading: { variants: [{ id: 'normal' }, { id: 'custom' }] },
  FilePathDisplay: {
    dependencies: ['lucide-react', 'path-browserify-esm'],
    variants: [{ id: 'image' }, { id: 'file' }, { id: 'directory' }],
  },
  GalleyGrid: { variants: [{ id: 'normal' }, { id: 'single' }, { id: 'compact' }] },
  GeneratingBorder: { variants: [{ id: 'resting' }, { id: 'generating' }] },
  InlineTable: {
    selector: '[data-component-mount] tbody tr',
    settleFrames: 2,
    variants: [
      { id: 'normal', states: interactive },
      { id: 'hoverable', states: interactive },
      { id: 'empty' },
    ],
  },
  LiteTable: {
    selector: '[data-component-mount] tbody tr[tabindex]',
    variants: ['normal', 'wide', 'fixed', 'loading', 'empty'].map((id) => ({
      id,
      states: id === 'loading' || id === 'empty' ? ['default'] : interactive,
    })),
  },
  OptionCard: {
    dependencies: ['lucide-react'],
    selector: '[data-component-mount] [role="option"]',
    variants: [
      { id: 'normal', states: interactive },
      { id: 'selected', states: interactive },
      { id: 'highlighted', states: interactive },
      { id: 'disabled', states: interactive },
    ],
  },
  OptionRow: {
    dependencies: ['lucide-react'],
    selector: '[data-component-mount] > div > div',
    variants: [
      { id: 'normal', states: interactive },
      { id: 'active', states: interactive },
      { id: 'disabled', states: interactive },
    ],
  },
  StatusBar: {
    dependencies: ['i18next', 'react-i18next'],
    i18n: true,
    selector: '[data-component-mount] button',
    variants: [
      { id: 'normal', states: interactive },
      { id: 'readonly', states: interactive },
      { id: 'tabs', states: interactive },
      { id: 'wrap', states: interactive },
    ],
  },
  TailMarquee: {
    selector: '[data-component-mount] button',
    selectors: {
      'hover': '[data-component-mount] button > div',
      'focus-visible': '[data-component-mount] button',
    },
    settleFrames: 2,
    variants: [
      { id: 'overflow', states: interactive },
      { id: 'short', states: interactive },
    ],
  },
  UnreadDot: { variants: [{ id: 'normal' }] },
  VersionTag: { variants: [{ id: 'normal' }] },
};

export const getStyleFixture = (id: string): StyleFixture => {
  const entry = experimentalFixtures.find(([name]) => name === id);
  const profile = profiles[id];
  if (!entry || !profile) throw new Error(`FIXTURE_ADAPTER_UNAVAILABLE:${id}`);
  const component = { exportName: id === 'FilePathDisplay' ? id : 'default', source: entry[1] };
  return styleFixtureSchema.parse({
    assets: profile.i18n ? ['fixtures/FixtureI18n.tsx'] : [],
    component: { base: component, candidate: component, id },
    containerMode: id === 'LiteTable' ? 'component-root' : 'fixture-wrapper',
    defaultInteractionSelector: profile.selector,
    dependencyRoots: profile.dependencies ?? [],
    fontContract: {
      family: 'Arial, sans-serif',
      mode: 'system-font-diagnostic',
      productionFontsVerified: false,
    },
    host: 'fixtures/FixtureHost.tsx',
    id,
    interactionSelectors: profile.selectors,
    probeWidths: id === 'LiteTable' ? [320, 599, 600, 601, 799, 800, 801, 920] : [320, 600, 920],
    render: `fixtures/${id}Fixture.tsx`,
    settleFrames: profile.settleFrames ?? 0,
    sizeContract: { host: [320, 920], viewport: [320, 1200] },
    styleVariants: profile.variants.map((variant) => ({ ...variant, expectedUnits: [] })),
    surfaces: [
      { id: 'host', kind: 'host', selector: '[data-verification-host]' },
      { id: 'component', kind: 'component', selector: '[data-component-mount] > *' },
    ],
  });
};

export const discoverFixtureCandidates = (scope: ScopeInventory) => {
  const changed = new Set(scope.units.map((unit) => unit.file));
  return {
    candidates: experimentalFixtures
      .filter(([, file]) => changed.has(file))
      .map(([componentId, source]) => ({
        componentId,
        reasonCode: 'FIXTURE_BINDING_NOT_CERTIFIED',
        source,
      })),
    unmappedFiles: [...changed]
      .filter((file) => !experimentalFixtures.some(([, source]) => source === file))
      .sort(),
  };
};
