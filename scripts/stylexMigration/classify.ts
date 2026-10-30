/**
 * Static classification of emotion-based style code for the StyleX migration.
 *
 * Tiers, by the hardest nested selector in a file's css`` blocks:
 * - A: flat declarations, cssVar and @media / @container only — codemod
 * - B: pseudo-classes / attributes on the element itself (`&:hover`) — codemod
 * - C: descendant or ancestor coupling (`& .child`, `.parent:hover &`) — manual,
 *      stylex.defaultMarker() / stylex.when.ancestor() or an xstyle prop
 * - D: tag or third-party DOM selectors (`li`, `svg`, `.ProseMirror`) — scoped CSS
 */

import legacyImports from './legacyImports.json';

export type MigrationTier = 'A' | 'B' | 'C' | 'D';

export type SelectorKind =
  'ancestor' | 'at-rule' | 'descendant' | 'keyframe-step' | 'media' | 'pseudo' | 'third-party';

export interface StyleFileReport {
  blocks: number;
  kinds: SelectorKind[];
  legacyImports: string[];
  tier: MigrationTier;
}

/** @lobehub/ui exports backed by the emotion runtime that new code must not use. */
export const LEGACY_STYLE_IMPORTS: readonly string[] = legacyImports;

const THIRD_PARTY =
  /\.ant(?:-|icon)|\.lobe-|:global|\.cm-|ProseMirror|\.markdown|\.katex|\.shiki|\[class|\.(?:rc|monaco|xterm|react-flow|tiptap)/;
const TAG =
  /(?:^|[\s(+,>~])(?:a|blockquote|button|canvas|code|div|em|h[1-6]|hr|iframe|img|input|label|li|ol|p|path|pre|span|strong|svg|table|tbody|td|textarea|th|thead|tr|ul|video)(?=$|[\s#),.:>[+~])/;
const SELF = /^&(?::{1,2}[\w-]+(?:\([^)]*\))?|\[[^\]]+\])*$/;
const ANCESTOR = /^[^&]+&(?::{1,2}[\w-]+|\[[^\]]+\])*$/;

const RANK: Record<SelectorKind, number> = {
  'ancestor': 1,
  'at-rule': 0,
  'descendant': 2,
  'keyframe-step': 0,
  'media': 0,
  'pseudo': 0,
  'third-party': 3,
};

export const classifySelector = (selector: string): SelectorKind => {
  const sel = selector.trim();
  if (/^@(?:media|container|supports)/.test(sel)) return 'media';
  if (sel.startsWith('@')) return 'at-rule';
  if (/^(?:from|to|\d+%)/.test(sel)) return 'keyframe-step';

  let worst: SelectorKind = 'pseudo';
  for (const part of sel.split(',').map((p) => p.trim())) {
    let kind: SelectorKind;
    if (THIRD_PARTY.test(part)) kind = 'third-party';
    else if (SELF.test(part)) kind = 'pseudo';
    else if (ANCESTOR.test(part)) kind = 'ancestor';
    else kind = TAG.test(part.replaceAll('&', ' ')) ? 'third-party' : 'descendant';
    if (RANK[kind] > RANK[worst]) worst = kind;
  }
  return worst;
};

/** css`` bodies with `${responsive.*}` as @media, other interpolations as `X`, no comments. */
export const extractCssBlocks = (source: string) =>
  (source.match(/css`[\S\s]*?`/g) ?? []).map((block) =>
    block
      .slice(4, -1)
      .replaceAll(/\$\{\s*responsive\.\w+\s*\}/g, '@media X')
      .replaceAll(/\$\{[^}]*\}/g, 'X')
      .replaceAll(/\/\*[\S\s]*?\*\//g, '')
      .replaceAll(/^\s*\/\/.*$/gm, ''),
  );

export const findLegacyImports = (source: string) => {
  const names = new Set<string>();
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@lobehub\/ui["']/g)) {
    for (const spec of match[1].split(',')) {
      const name = spec
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0];
      if (LEGACY_STYLE_IMPORTS.includes(name)) names.add(name);
    }
  }
  return [...names].sort();
};

export const classifySource = (source: string): StyleFileReport => {
  const blocks = extractCssBlocks(source);
  const kinds = new Set<SelectorKind>();
  for (const block of blocks) {
    for (const match of block.matchAll(/([^;{}]+)\{/g)) {
      kinds.add(classifySelector(match[1]));
    }
  }

  let tier: MigrationTier = 'A';
  if (kinds.has('third-party')) tier = 'D';
  else if (kinds.has('descendant') || kinds.has('ancestor')) tier = 'C';
  else if (kinds.has('pseudo')) tier = 'B';

  return {
    blocks: blocks.length,
    kinds: [...kinds].sort(),
    legacyImports: findLegacyImports(source),
    tier,
  };
};
