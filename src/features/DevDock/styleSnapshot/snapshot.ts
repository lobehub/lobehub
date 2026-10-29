const STYLE_PROPS = [
  'display',
  'position',
  'zIndex',
  'visibility',
  'flexDirection',
  'flexWrap',
  'alignItems',
  'justifyContent',
  'gap',
  'gridTemplateColumns',
  'overflow',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'transform',
  'color',
  'backgroundColor',
  'backgroundImage',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textDecorationLine',
  'textOverflow',
  'whiteSpace',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderTopStyle',
  'borderRightStyle',
  'borderBottomStyle',
  'borderLeftStyle',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomRightRadius',
  'borderBottomLeftRadius',
  'outlineStyle',
  'outlineWidth',
  'outlineColor',
  'boxShadow',
  'opacity',
  'cursor',
  'pointerEvents',
  'transition',
  'animationName',
] as const;

type StyleProp = (typeof STYLE_PROPS)[number];

export interface StyleSnapshotEntry {
  box: string;
  key: string;
  label: string;
  style: Record<StyleProp, string>;
}

export interface StyleSnapshotDiff {
  added?: true;
  box?: [string, string];
  changed?: Partial<Record<StyleProp, [string, string]>>;
  key: string;
  label: string;
  removed?: true;
  text?: [string, string];
}

const ANIMATED = 'animated';
const PSEUDO_ELEMENTS = ['::before', '::after'] as const;

const isAnimating = (element: Element) =>
  element.getAnimations?.().some((animation) => animation.playState === 'running') ?? false;

const pickStyle = (computed: CSSStyleDeclaration, animated: boolean) =>
  Object.fromEntries(
    STYLE_PROPS.map((prop) => [prop, animated ? ANIMATED : computed[prop]]),
  ) as Record<StyleProp, string>;

// Boxes are relative to the root so a recentered modal or a scrolled page does
// not register as a change; a scrolled container inside the root would, so
// capture refuses it. Elements under a running animation (spinners, pulses)
// change every frame, so neither their boxes nor their styles are recorded.
export const captureStyles = (root: Element): StyleSnapshotEntry[] => {
  const origin = root.getBoundingClientRect();
  const entries: StyleSnapshotEntry[] = [];

  const assertNotScrolled = (element: Element, key: string) => {
    if (element.scrollTop || element.scrollLeft)
      throw new Error(
        `[styleSnapshot] ${key} ${element.tagName}:${(element.textContent ?? '').trim().slice(0, 24)} is scrolled; scroll it back to the start, or narrow the root selector`,
      );
  };

  const visit = (element: Element, key: string, insideAnimation: boolean) => {
    const computed = getComputedStyle(element);
    if (computed.display === 'none') return;
    assertNotScrolled(element, key);

    const animated = insideAnimation || isAnimating(element);
    const rect = element.getBoundingClientRect();
    entries.push({
      box: animated
        ? ANIMATED
        : [rect.x - origin.x, rect.y - origin.y, rect.width, rect.height]
            .map((n) => Math.round(n))
            .join(','),
      key,
      label: `${element.tagName}:${(element.textContent ?? '').trim().slice(0, 24)}`,
      style: pickStyle(computed, animated),
    });

    for (const pseudo of PSEUDO_ELEMENTS) {
      const pseudoStyle = getComputedStyle(element, pseudo);
      if (['', 'none', 'normal'].includes(pseudoStyle.content)) continue;
      entries.push({
        box: 'pseudo',
        key: `${key}${pseudo}`,
        label: `${element.tagName}${pseudo}:${pseudoStyle.content.slice(0, 24)}`,
        style: pickStyle(pseudoStyle, animated),
      });
    }

    [...element.children].forEach((child, index) => visit(child, `${key}.${index}`, animated));
  };

  assertNotScrolled(root, 'root');
  [...root.children].forEach((child, index) => visit(child, String(index), false));
  return entries;
};

export const diffStyleSnapshots = (
  before: StyleSnapshotEntry[],
  after: StyleSnapshotEntry[],
): StyleSnapshotDiff[] => {
  const afterByKey = new Map(after.map((entry) => [entry.key, entry]));
  const beforeKeys = new Set(before.map((entry) => entry.key));
  const diffs: StyleSnapshotDiff[] = [];

  for (const prev of before) {
    const next = afterByKey.get(prev.key);
    if (!next) {
      diffs.push({ key: prev.key, label: prev.label, removed: true });
      continue;
    }
    const changed: StyleSnapshotDiff['changed'] = {};
    for (const prop of STYLE_PROPS) {
      if (prev.style[prop] !== next.style[prop])
        changed[prop] = [prev.style[prop], next.style[prop]];
    }
    const boxChanged = prev.box !== next.box;
    const textChanged = prev.label !== next.label;
    if (boxChanged || textChanged || Object.keys(changed).length > 0)
      diffs.push({
        ...(boxChanged && { box: [prev.box, next.box] as [string, string] }),
        ...(Object.keys(changed).length > 0 && { changed }),
        key: prev.key,
        label: prev.label,
        ...(textChanged && { text: [prev.label, next.label] as [string, string] }),
      });
  }

  for (const next of after) {
    if (!beforeKeys.has(next.key)) diffs.push({ added: true, key: next.key, label: next.label });
  }

  return diffs;
};

export interface PackedSnapshot {
  rows: [key: string, label: string, box: string, style: number][];
  styles: string[];
}

const STYLE_SEPARATOR = '\u0001';

// localStorage holds ~5 MB per origin; most elements share one computed style.
export const packSnapshot = (entries: StyleSnapshotEntry[]): PackedSnapshot => {
  const styles: string[] = [];
  const ids = new Map<string, number>();
  const rows = entries.map(({ box, key, label, style }): PackedSnapshot['rows'][number] => {
    const packed = STYLE_PROPS.map((prop) => style[prop]).join(STYLE_SEPARATOR);
    let id = ids.get(packed);
    if (id === undefined) {
      id = styles.length;
      styles.push(packed);
      ids.set(packed, id);
    }
    return [key, label, box, id];
  });
  return { rows, styles };
};

export const unpackSnapshot = ({ rows, styles }: PackedSnapshot): StyleSnapshotEntry[] =>
  rows.map(([key, label, box, id]) => {
    const values = styles[id].split(STYLE_SEPARATOR);
    return {
      box,
      key,
      label,
      style: Object.fromEntries(STYLE_PROPS.map((prop, index) => [prop, values[index]])) as Record<
        StyleProp,
        string
      >,
    };
  });
