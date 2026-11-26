const SIDES = ['top', 'right', 'bottom', 'left'];
const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

const SHORTHANDS: Record<string, string[]> = {
  'animation': [
    'animation-name',
    'animation-duration',
    'animation-timing-function',
    'animation-delay',
    'animation-iteration-count',
    'animation-direction',
    'animation-fill-mode',
  ],
  'background': [
    'background-color',
    'background-image',
    'background-position',
    'background-size',
    'background-repeat',
    'background-attachment',
    'background-origin',
    'background-clip',
  ],
  'border': SIDES.flatMap((side) =>
    ['width', 'style', 'color'].map((part) => `border-${side}-${part}`),
  ),
  'border-color': SIDES.map((side) => `border-${side}-color`),
  'border-radius': CORNERS.map((corner) => `border-${corner}-radius`),
  'border-style': SIDES.map((side) => `border-${side}-style`),
  'border-width': SIDES.map((side) => `border-${side}-width`),
  'flex': ['flex-grow', 'flex-shrink', 'flex-basis'],
  'font': [
    'font-family',
    'font-size',
    'font-style',
    'font-weight',
    'font-variant',
    'font-stretch',
    'line-height',
  ],
  'gap': ['row-gap', 'column-gap'],
  'inset': SIDES,
  'margin': SIDES.map((side) => `margin-${side}`),
  'margin-block': ['margin-top', 'margin-bottom'],
  'margin-inline': ['margin-left', 'margin-right'],
  'overflow': ['overflow-x', 'overflow-y'],
  'padding': SIDES.map((side) => `padding-${side}`),
  'padding-block': ['padding-top', 'padding-bottom'],
  'padding-inline': ['padding-left', 'padding-right'],
  'transition': [
    'transition-property',
    'transition-duration',
    'transition-timing-function',
    'transition-delay',
  ],
};

const IGNORED = new Set(['default']);

const kebab = (name: string) =>
  name.includes('-')
    ? name.toLowerCase()
    : name.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

export const declaredProperties = (texts: string[]) => {
  const found = new Set<string>();
  for (const text of texts) {
    const names = [...text.matchAll(/(?<![\w$:'"-])['"]?([A-Za-z][\w-]*)['"]?\s*:(?!:)/g)].map(
      (match) => match[1],
    );
    for (const name of names.slice(1)) {
      if (IGNORED.has(name)) continue;
      const property = kebab(name);
      for (const longhand of SHORTHANDS[property] ?? [property]) found.add(longhand);
    }
  }
  return [...found].sort();
};

export const shorthandsIn = (text: string) =>
  Object.keys(SHORTHANDS).filter((name) =>
    new RegExp(`(?<![\\w-])${name}\\s*:`).test(
      text.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
    ),
  );
