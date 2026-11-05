import type { FileExtraction, LiteralValue, StyleBinding, StyleElement } from '../extract';
import { elementsOf } from '../plan/descendants';
import type { InnerNode } from '../plan/inner';
import { bindKnobs } from '../plan/knobs';
import { chainOf, type FilePlan, isIntrinsicTag, type Side } from '../plan/planFile';
import { innerMarkup } from './inner';

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

interface ChainContext {
  exprOf: (binding: StyleBinding) => string;
  inner?: Record<string, InnerNode[]>;
  layout: Set<string>;
  probed: Set<string>;
}

const renderChain = (chain: StyleElement[], context: ChainContext, depth = 0): string => {
  const { exprOf, layout, probed } = context;
  const [element, ...rest] = chain;
  const tag = placementTag(element, layout);
  const substituted = tag !== element.tag;
  const attributes = [`data-synthetic-element=${JSON.stringify(element.id)}`];
  for (const [name, value] of Object.entries(element.literalProps))
    if (keepLiteral(name, substituted)) attributes.push(renderLiteral(name, value));
  const neutral: string[] = [];
  for (const binding of element.bindings) {
    const expr = exprOf(binding);
    if (binding.spread) attributes.push(`{...(${expr})}`);
    else if (binding.prop === 'className') attributes.push(`className={${expr}}`);
    else neutral.push(`{__neutral(${JSON.stringify(binding.prop)}, ${expr})}`);
  }
  if (element.runtimeStyle && probed.has(element.runtimeStyle))
    attributes.push(`style={${element.runtimeStyle}}`);
  const open = `<${tag} ${attributes.join(' ')}`;
  if (VOID_TAGS.has(tag)) return `<>${open} />${neutral.join('')}</>`;
  const inner = rest.length
    ? renderChain(rest, context, depth + 1)
    : `{${JSON.stringify(SAMPLE_TEXT)}}`;
  const targets = innerMarkup(context.inner?.[depth], SAMPLE_TEXT);
  return `${open}>${inner}${targets}${neutral.join('')}</${tag}>`;
};

const NEUTRAL = `const __neutral = (prop: string, value: unknown): any => {
  if (value == null || value === false) return null;
  if (typeof value === 'string') return <div data-synthetic-neutral={prop} className={value}>{${JSON.stringify(SAMPLE_TEXT)}}</div>;
  if (typeof value === 'object' && 'className' in (value as object)) return <div data-synthetic-neutral={prop} {...(value as object)}>{${JSON.stringify(SAMPLE_TEXT)}}</div>;
  if (typeof value === 'object') return Object.entries(value as Record<string, unknown>).map(([key, item]) => <div key={key} data-synthetic-slot={key}>{__neutral(prop + '.' + key, item)}</div>);
  return null;
};
const __probe = (name: string): any => ({ '--style-equivalence-probe': name, tabSize: 7 });
const __member = (value: boolean): any => new Proxy({}, { get: () => value });
const __opaque: any = new Proxy(function () {}, {
  apply: () => __opaque,
  construct: () => __opaque,
  get: (_, key) => (key === Symbol.toPrimitive ? () => '' : key === 'then' ? undefined : __opaque),
});`;

export const generateModule = (
  extraction: FileExtraction,
  plan: FilePlan,
  side: Side,
  config: GenerateConfig,
) => {
  const layout = new Set(config.layoutComponents);
  const byId = new Map(elementsOf(extraction).map((element) => [element.id, element]));
  const entries = plan.cases.map((entry) => {
    const element = byId.get(entry.elementIds[side]);
    if (!element)
      return `${JSON.stringify(entry.key)}: () => { throw new Error('CASE_ELEMENT_MISSING'); }`;
    const chain = chainOf(element, byId);
    const { knobs } = entry;
    const bound = new Map<StyleBinding, string | undefined>(
      chain.flatMap((item) =>
        item.bindings.map((binding) => [
          binding,
          knobs ? bindKnobs(binding.expr, knobs) : binding.expr,
        ]),
      ),
    );
    if ([...bound.values()].includes(undefined))
      return `${JSON.stringify(entry.key)}: () => { throw new Error('KNOB_UNBOUND'); }`;
    const declared = new Set<string>();
    const lines: string[] = [];
    const probed = new Set<string>();
    for (const variable of entry.variables) {
      if (variable.probe) {
        probed.add(variable.name);
        declared.add(variable.name);
        lines.push(
          `const ${variable.name} = __v[${JSON.stringify(variable.name)}] ? __probe(${JSON.stringify(variable.name)}) : undefined;`,
        );
        continue;
      }
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
    const expressions = chain.flatMap((item) => item.bindings.map((binding) => binding.expr));
    const readThrough = (name: string) =>
      expressions.some((expr) => new RegExp(`(^|[^\\w$.])${name}\\s*(\\?\\.|\\.|\\[)`).test(expr));
    for (const item of chain)
      for (const variable of item.variables) {
        if (declared.has(variable.name)) continue;
        declared.add(variable.name);
        lines.push(
          variable.name === 'cx' && config.cxFallback
            ? `const cx = __cx;`
            : `const ${variable.name} = ${readThrough(variable.name) ? '__opaque' : 'undefined'};`,
        );
      }
    return `${JSON.stringify(entry.key)}: (__v: Record<string, boolean | string>) => { ${lines.join(' ')} return (${renderChain(chain, { exprOf: (binding) => bound.get(binding)!, inner: entry.inner, layout, probed })}); }`;
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
