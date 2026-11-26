const COLOR = /color\(srgb\s+([^)]*)\)|rgba?\(([^)]*)\)/g;

interface Rgba {
  alpha: number;
  channels: number[];
}

const parse = (match: RegExpMatchArray): Rgba | undefined => {
  const srgb = match[1] !== undefined;
  const body = (srgb ? match[1] : match[2]).trim();
  const [color, alpha] = body.includes('/') ? body.split('/') : [body, undefined];
  const parts = color.split(/[\s,]+/).filter(Boolean);
  const rest = srgb ? alpha : parts.length === 4 ? parts.pop() : alpha;
  const values = parts.map(Number);
  if (values.length !== 3 || values.some(Number.isNaN)) return undefined;
  const a =
    rest === undefined
      ? 1
      : Number(rest.trim().replace(/%$/, '')) / (rest.trim().endsWith('%') ? 100 : 1);
  if (Number.isNaN(a)) return undefined;
  return { alpha: a, channels: srgb ? values.map((value) => value * 255) : values };
};

const split = (value: string) => {
  const colors: Rgba[] = [];
  let failed = false;
  const skeleton = value.replaceAll(COLOR, (...args) => {
    const color = parse(args as unknown as RegExpMatchArray);
    if (!color) failed = true;
    else colors.push(color);
    return '<color>';
  });
  return failed ? undefined : { colors, skeleton };
};

export const sameStyleValue = (before: string | undefined, after: string | undefined) => {
  if (before === after) return true;
  if (before === undefined || after === undefined) return false;
  const [left, right] = [split(before), split(after)];
  if (!left || !right || !left.colors.length || left.skeleton !== right.skeleton) return false;
  return left.colors.every((color, index) => {
    const other = right.colors[index];
    return (
      Math.abs(color.alpha - other.alpha) <= 0.01 &&
      color.channels.every((channel, at) => Math.abs(channel - other.channels[at]) <= 1)
    );
  });
};
