export interface Compound {
  attributes: Array<{ name: string; value?: string }>;
  tag?: string;
}

const topLevel = (selector: string, isBreak: (char: string) => boolean) => {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of selector) {
    if (char === '[' || char === '(') depth += 1;
    else if (char === ']' || char === ')') depth -= 1;
    if (depth === 0 && isBreak(char)) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
};

const collapseCombinators = (selector: string) =>
  selector.replaceAll(/\s*([>+~])\s*/g, '$1').replaceAll(/\s+/g, ' ');

const ATTRIBUTE = /\[\s*([\w-]+)\s*(?:=\s*(["']?)(.*?)\2\s*)?\]/g;

const compoundOf = (part: string): Compound | undefined => {
  const pieces = topLevel(collapseCombinators(part.trim()), (char) => /[ >+~]/.test(char));
  const compound = pieces.at(-1) ?? '';
  const bare = compound.replaceAll(/\[[^\]]*\]|\([^)]*\)/g, '');
  if (/[.#&]/.test(bare)) return undefined;
  const tag = /^[a-z][\w-]*/i.exec(bare)?.[0];
  const attributes = [...compound.matchAll(ATTRIBUTE)].map(([, name, , value]) => ({
    name,
    value,
  }));
  return tag || attributes.length ? { attributes, tag } : undefined;
};

export const lastCompounds = (selector: string): Compound[] | undefined => {
  const compounds = topLevel(selector, (char) => char === ',').map(compoundOf);
  return compounds.every(Boolean) ? (compounds as Compound[]) : undefined;
};

export const targetsDescendant = (selector: string) =>
  topLevel(selector, (char) => char === ',').some((raw) => {
    const part = raw.trim();
    const ampersands = topLevel(part, (char) => char === '&');
    if (ampersands.length === 1) return !part.startsWith(':');
    const rest = collapseCombinators(ampersands.at(-1)!).trimEnd();
    return topLevel(rest, (char) => char === ' ' || char === '>').length > 1;
  });
