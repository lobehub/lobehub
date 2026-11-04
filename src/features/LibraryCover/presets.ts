/**
 * Library covers are stored as a string in `knowledge_bases.settings.cover`:
 * `preset:<id>` for a built-in gradient, otherwise an uploaded image URL. A
 * library without one gets a preset picked from its id, so every card has a
 * stable, distinct cover from the moment it is created.
 */
export const COVER_PRESET_PREFIX = 'preset:';

export interface LibraryCoverPreset {
  background: string;
  id: string;
}

export const LIBRARY_COVER_PRESETS: LibraryCoverPreset[] = [
  { background: 'linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)', id: 'sky' },
  { background: 'linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 100%)', id: 'aurora' },
  { background: 'linear-gradient(135deg, #fddb92 0%, #d1fdff 100%)', id: 'dawn' },
  { background: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)', id: 'sunset' },
  { background: 'linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)', id: 'mint' },
  { background: 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)', id: 'meadow' },
  { background: 'linear-gradient(135deg, #cfd9df 0%, #e2ebf0 100%)', id: 'mist' },
  { background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', id: 'dusk' },
];

const PRESET_BY_ID = new Map(LIBRARY_COVER_PRESETS.map((preset) => [preset.id, preset]));

export const presetCoverValue = (id: string) => `${COVER_PRESET_PREFIX}${id}`;

const hashSeed = (seed: string): number => {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(hash);
};

/** The preset a library without a chosen cover shows, stable for its id. */
export const defaultCoverPreset = (seed: string): LibraryCoverPreset =>
  LIBRARY_COVER_PRESETS[hashSeed(seed) % LIBRARY_COVER_PRESETS.length];

export type ResolvedLibraryCover =
  { background: string; kind: 'preset'; presetId: string } | { kind: 'image'; url: string };

/** What a stored cover value renders as; unknown or empty values fall back to the default. */
export const resolveLibraryCover = (cover: unknown, seed: string): ResolvedLibraryCover => {
  if (typeof cover === 'string' && cover) {
    if (cover.startsWith(COVER_PRESET_PREFIX)) {
      const preset = PRESET_BY_ID.get(cover.slice(COVER_PRESET_PREFIX.length));
      if (preset) return { background: preset.background, kind: 'preset', presetId: preset.id };
    } else if (/^(?:https?:|\/|data:image\/)/.test(cover)) {
      return { kind: 'image', url: cover };
    }
  }

  const preset = defaultCoverPreset(seed);
  return { background: preset.background, kind: 'preset', presetId: preset.id };
};

/** The cover a library item stores, read defensively from its untyped settings. */
export const libraryCoverOf = (settings: unknown): string | undefined => {
  const cover = (settings as { cover?: unknown } | null | undefined)?.cover;
  return typeof cover === 'string' ? cover : undefined;
};
