import type { FileExtraction, LiteralValue, StyleElement } from '../extract';
import { chainOf, type FilePlan, isIntrinsicTag, type Side } from '../plan/planFile';

export const SAMPLE_TEXT = 'Ag 文本 Text';

const VOID_TAGS = new Set(['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'source', 'wbr']);

export interface GenerateConfig {
  cxFallback?: { name: string; source: string };
  layoutComponents: string[];
}

const placementTag = (element: StyleElement, layout: Set<string>) =>
  isIntrinsicTag(element.tag) || layout.has(element.tag) ? element.tag : 'div';

const keepLiteral = (name: string, substituted: boolean) => {
  if (name === 'key' || name === 'ref' || /^on[A-Z]/.test(name)) return false;
  return substituted ? /^(?:data-|aria-|role$)/.test(name) : true;
};

const renderLiteral = (name: string, value: LiteralValue) =>
  typeof value === 'string'
    ? `${name}=${JSON.stringify(value)}`
    : `${name}={${JSON.stringify(value)}}`;

const renderChain = (chain: StyleElement[], layout: Set<string>): string => {
  const [element, ...rest] = chain;
  const tag = placementTag(element, layout);
  const substituted = tag !== element.tag;
  const attributes = [`data-synthetic-element=${JSON.stringify(element.id)}`];
  for (const [name, value] of Object.entries(element.literalProps))
    if (keepLiteral(name, substituted)) attributes.push(renderLiteral(name, value));
  const neutral: string[] = [];
  for (const binding of element.bindings) {
    if (binding.spread) attributes.push(`{...(${binding.expr})}`);
    else if (binding.prop === 'className') attributes.push(`className={${binding.expr}}`);
    else neutral.push(`{__neutral(${JSON.stringify(binding.prop)}, ${binding.expr})}`);
  }
  const open = `<${tag} ${attributes.join(' ')}`;
  if (VOID_TAGS.has(tag)) return `<>${open} />${neutral.join('')}</>`;
  const inner = rest.length ? renderChain(rest, layout) : `{${JSON.stringify(SAMPLE_TEXT)}}`;
  return `${open}>${inner}${neutral.join('')}</${tag}>`;
};

const NEUTRAL = `const __neutral = (prop: string, value: unknown): any => {
  if (value == null || value === false) return null;
  if (typeof value === 'string') return <div data-synthetic-neutral={prop} className={value}>{${JSON.stringify(SAMPLE_TEXT)}}</div>;
  if (typeof value === 'object' && 'className' in (value as object)) return <div data-synthetic-neutral={prop} {...(value as object)}>{${JSON.stringify(SAMPLE_TEXT)}}</div>;
  if (typeof value === 'object') return Object.entries(value as Record<string, unknown>).map(([key, item]) => <div key={key} data-synthetic-slot={key}>{__neutral(prop + '.' + key, item)}</div>);
  return null;
};
const __member = (value: boolean): any => new Proxy({}, { get: () => value });`;

export const generateModule = (
  extraction: FileExtraction,
  plan: FilePlan,
  side: Side,
  config: GenerateConfig,
) => {
  const layout = new Set(config.layoutComponents);
  const byId = new Map(extraction.elements.map((element) => [element.id, element]));
  const entries = plan.cases.map((entry) => {
    const element = byId.get(entry.elementIds[side]);
    if (!element)
      return `${JSON.stringify(entry.key)}: () => { throw new Error('CASE_ELEMENT_MISSING'); }`;
    const chain = chainOf(element, byId);
    const declared = new Set<string>();
    const lines: string[] = [];
    for (const variable of entry.variables) {
      const kind = variable.kinds[side];
      if (!kind) continue;
      declared.add(variable.name);
      const value = `__v[${JSON.stringify(variable.name)}]`;
      lines.push(
        kind === 'call'
          ? `const ${variable.name} = () => ${value};`
          : kind === 'member'
            ? `const ${variable.name} = __member(${value});`
            : `const ${variable.name} = ${value};`,
      );
    }
    for (const item of chain)
      for (const variable of item.variables) {
        if (declared.has(variable.name)) continue;
        declared.add(variable.name);
        lines.push(
          variable.name === 'cx' && config.cxFallback
            ? `const cx = __cx;`
            : `const ${variable.name} = undefined;`,
        );
      }
    return `${JSON.stringify(entry.key)}: (__v: Record<string, boolean>) => { ${lines.join(' ')} return (${renderChain(chain, layout)}); }`;
  });
  return [
    extraction.prelude,
    config.cxFallback
      ? `import { ${config.cxFallback.name} as __cx } from ${JSON.stringify(config.cxFallback.source)};`
      : '',
    NEUTRAL,
    `export const side = ${JSON.stringify(side)};`,
    `export const cases = {\n${entries.join(',\n')}\n};`,
  ]
    .filter(Boolean)
    .join('\n');
};
