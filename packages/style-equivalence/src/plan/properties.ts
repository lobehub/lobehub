const SIDES = ['top', 'right', 'bottom', 'left'];
const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

const ALIASES: Record<string, string> = {
  'grid-column-gap': 'column-gap',
  'grid-gap': 'gap',
  'grid-row-gap': 'row-gap',
  'word-wrap': 'overflow-wrap',
};

const SHORTHANDS: Record<string, string[]> = {
  'border-color': SIDES.map((side) => `border-${side}-color`),
  'border-radius': CORNERS.map((corner) => `border-${corner}-radius`),
  'border-style': SIDES.map((side) => `border-${side}-style`),
  'border-width': SIDES.map((side) => `border-${side}-width`),
  'columns': ['column-width', 'column-count'],
  'flex-flow': ['flex-direction', 'flex-wrap'],
  'font': ['font', 'line-height'],
  'gap': ['row-gap', 'column-gap'],
  'grid-area': ['grid-row', 'grid-column'],
  'inset': SIDES,
  'overflow-block': ['overflow-y'],
  'overflow-inline': ['overflow-x'],
  'place-content': ['align-content', 'justify-content'],
  'place-items': ['align-items', 'justify-items'],
  'place-self': ['align-self', 'justify-self'],
  'white-space': ['white-space', 'text-wrap-mode'],
};

const LOGICAL_CORNER = /^border-(start|end)-(start|end)-radius$/;
const LOGICAL_AXIS = /-(inline|block)(?:-start|-end)?(?=-|$)/;

const physical = (property: string): string[] => {
  if (LOGICAL_CORNER.test(property)) return CORNERS.map((corner) => `border-${corner}-radius`);
  const sized = property
    .replace(/(^|-)inline-size$/, '$1width')
    .replace(/(^|-)block-size$/, '$1height');
  const match = LOGICAL_AXIS.exec(sized);
  if (!match || SHORTHANDS[sized]) return [sized];
  const sides = match[1] === 'inline' ? ['left', 'right'] : ['top', 'bottom'];
  return sides.flatMap((side) =>
    physical(`${sized.slice(0, match.index)}-${side}${sized.slice(match.index + match[0].length)}`),
  );
};

const expand = (raw: string): string[] => {
  const unprefixed = raw.toLowerCase().replace(/^-(?:webkit|moz|ms|o)-/, '');
  const name = ALIASES[unprefixed] ?? unprefixed;
  return physical(name).flatMap((property) => {
    const side = /^inset-(top|right|bottom|left)$/.exec(property);
    if (side) return [side[1]];
    const longhands = SHORTHANDS[property];
    return longhands
      ? [property, ...longhands.flatMap((item) => (item === property ? [item] : expand(item)))]
      : [property];
  });
};

const related = (left: string, right: string) =>
  left === 'all' ||
  right === 'all' ||
  left === right ||
  left.startsWith(`${right}-`) ||
  right.startsWith(`${left}-`);

export const propertiesOverlap = (left: Iterable<string>, right: Iterable<string>) => {
  const expanded = [...right].flatMap(expand);
  return [...left]
    .flatMap(expand)
    .some((property) => expanded.some((other) => related(property, other)));
};
