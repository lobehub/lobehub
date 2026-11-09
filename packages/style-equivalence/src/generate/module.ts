import type { FileExtraction, RealComponent, StyleBinding, StyleElement } from '../extract';
import type { ForwardElement } from '../extract/forward';
import { elementsOf } from '../plan/descendants';
import type { InnerNode } from '../plan/inner';
import { bindKnobs } from '../plan/knobs';
import { chainOf, type FilePlan, isIntrinsicTag, type Side } from '../plan/planFile';
import { rendersReal } from '../plan/real';
import { applicationOf, forwardImports, renderForward } from './forward';
import { innerMarkup } from './inner';
import { keepLiteral, renderLiteral, SAMPLE_TEXT, VOID_TAGS } from './literal';

export { SAMPLE_TEXT } from './literal';

export interface GenerateConfig {
  cxFallback?: { name: string; source: string };
  layoutComponents: string[];
  realComponents?: Record<string, RealComponent>;
}

const placementTag = (element: StyleElement, layout: Set<string>) =>
  isIntrinsicTag(element.tag) || layout.has(element.tag) ? element.tag : 'div';

interface ChainContext {
  byId?: Map<string, StyleElement>;
  exprOf: (binding: StyleBinding) => string;
  forward?: { application?: string; element: ForwardElement };
  inner?: Record<string, InnerNode[]>;
  layout: Set<string>;
  omitted?: number[];
  probed: Set<string>;
  real?: Record<string, RealComponent>;
  samples?: InnerNode[];
}

const sampleContent = (samples: InnerNode[] | undefined) =>
  samples?.length ? innerMarkup(samples, SAMPLE_TEXT) : `{${JSON.stringify(SAMPLE_TEXT)}}`;

const iconMarkup = (element: StyleElement, context: ChainContext) => {
  const icon =
    typeof element.iconElement === 'string' ? context.byId?.get(element.iconElement) : undefined;
  const attributes =
    icon && !icon.variables.length
      ? icon.bindings.flatMap((binding) =>
          binding.spread
            ? [`{...(${binding.expr})}`]
            : binding.prop === 'className'
              ? [`className={${binding.expr}}`]
              : [],
        )
      : [];
  return `<span ${['data-synthetic-icon=""', ...attributes].join(' ')}></span>`;
};

const renderChain = (chain: StyleElement[], context: ChainContext, depth = 0): string => {
  const { exprOf, layout, probed } = context;
  const [element, ...rest] = chain;
  if (!rest.length && context.forward)
    return renderForward(element.id, context.forward.element, context.forward.application);
  const real = rendersReal(element, !rest.length, context.real);
  const tag = real ? element.tag : placementTag(element, layout);
  const substituted = tag !== element.tag;
  const attributes = [`data-synthetic-element=${JSON.stringify(element.id)}`];
  for (const [name, value] of Object.entries(element.literalProps))
    if (keepLiteral(name, substituted)) attributes.push(renderLiteral(name, value));
  if (element.inlineStyle) attributes.push(`style={(${element.inlineStyle})}`);
  for (const [name, variable] of Object.entries(element.attributes ?? {}))
    attributes.push(`${name}={${variable}}`);
  const neutral: string[] = [];
  for (const binding of element.bindings) {
    const expr = exprOf(binding);
    if (binding.spread) attributes.push(`{...(${expr})}`);
    else if (binding.prop === 'className' || real) attributes.push(`${binding.prop}={${expr}}`);
    else if (!context.omitted?.includes(depth))
      neutral.push(`{__neutral(${JSON.stringify(binding.prop)}, ${expr})}`);
  }
  if (element.runtimeStyle && probed.has(element.runtimeStyle))
    attributes.push(`style={${element.runtimeStyle}}`);
  const component = real ? context.real?.[element.tag] : undefined;
  if (component?.sample) attributes.push(component.sample(sampleContent(context.samples)));
  const open = `<${tag} ${attributes.join(' ')}`;
  if (VOID_TAGS.has(tag) || component?.leaf) return `<>${open} />${neutral.join('')}</>`;
  const inner = rest.length
    ? renderChain(rest, context, depth + 1)
    : `{${JSON.stringify(SAMPLE_TEXT)}}`;
  const targets = innerMarkup(context.inner?.[depth], SAMPLE_TEXT);
  const icon = substituted && element.iconElement ? iconMarkup(element, context) : '';
  return `${open}>${icon}${inner}${targets}${neutral.join('')}</${tag}>`;
};

const NEUTRAL = `const __neutral = (prop: string, value: unknown): any => {
  if (value == null || value === false) return null;
  if (typeof value === 'string') return <div data-synthetic-neutral={prop} className={value}>{${JSON.stringify(SAMPLE_TEXT)}}</div>;
  if (typeof value === 'object' && /^styles\\.[^.]+$/.test(prop)) return <div data-synthetic-neutral={prop} style={value as any}>{${JSON.stringify(SAMPLE_TEXT)}}</div>;
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

const readsThrough = (expressions: string[], name: string) =>
  expressions.some((expr) => new RegExp(`(^|[^\\w$.])${name}\\s*(\\?\\.|\\.|\\[)`).test(expr));

const UNPAIRED_VALUES: Record<string, string> = {
  boolean: 'false',
  call: '() => false',
  member: '__member(false)',
};

export const unpairedKey = (file: string, side: Side, elementId: string) =>
  `${file}|unpaired:${side}:${elementId}`;

const unpairedEntry = (
  key: string,
  chain: StyleElement[],
  layout: Set<string>,
  config: GenerateConfig,
) => {
  const expressions = chain.flatMap((item) => item.bindings.map((binding) => binding.expr));
  const declared = new Set<string>();
  const lines: string[] = [];
  for (const [alias, symbol] of chain.flatMap((item) => Object.entries(item.aliases ?? {}))) {
    if (declared.has(alias)) continue;
    declared.add(alias);
    lines.push(`const ${alias} = ${symbol};`);
  }
  for (const variable of chain.flatMap((item) => item.variables)) {
    if (declared.has(variable.name)) continue;
    declared.add(variable.name);
    const value =
      variable.name === 'cx' && config.cxFallback
        ? '__cx'
        : (UNPAIRED_VALUES[variable.kind] ??
          (readsThrough(expressions, variable.name) ? '__opaque' : 'undefined'));
    lines.push(`const ${variable.name} = ${value};`);
  }
  return `${JSON.stringify(key)}: () => { ${lines.join(' ')} return (${renderChain(chain, { exprOf: (binding) => binding.expr, layout, probed: new Set(), real: config.realComponents })}); }`;
};

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
    const chain = chainOf(element, byId, entry.chainOmit?.[side]);
    const { knobs } = entry;
    const inline = entry.inlineStyles?.[side] ?? [];
    const bound = new Map<StyleBinding, string | undefined>(
      chain.flatMap((item, index) =>
        item.bindings.map((binding, position) => {
          const expr =
            inline.find((style) => style.index === index && style.binding === position)?.without ??
            binding.expr;
          return [binding, knobs ? bindKnobs(expr, knobs) : expr];
        }),
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
    for (const item of chain)
      for (const [alias, symbol] of Object.entries(item.aliases ?? {})) {
        if (declared.has(alias)) continue;
        declared.add(alias);
        lines.push(`const ${alias} = ${symbol};`);
      }
    for (const item of chain)
      for (const variable of item.variables) {
        if (declared.has(variable.name)) continue;
        declared.add(variable.name);
        lines.push(
          variable.name === 'cx' && config.cxFallback
            ? `const cx = __cx;`
            : `const ${variable.name} = ${readsThrough(expressions, variable.name) ? '__opaque' : 'undefined'};`,
        );
      }
    const target = entry.forward?.[side];
    const forwarded =
      entry.forward && element.bindings.find((item) => item.prop === entry.forward!.prop);
    const context = {
      byId,
      exprOf: (binding: StyleBinding) => bound.get(binding)!,
      forward: target && {
        application: forwarded && applicationOf(entry.forward!.application, bound.get(forwarded)!),
        element: target,
      },
      inner: entry.inner,
      layout,
      omitted: entry.neutralOmitted,
      probed,
      real: config.realComponents,
      samples: entry.samples,
    };
    return `${JSON.stringify(entry.key)}: (__v: Record<string, boolean | string>) => { ${lines.join(' ')} return (${renderChain(chain, context)}); }`;
  });
  const unpaired = plan.unpaired
    .filter((entry) => entry.side === side && byId.has(entry.elementId))
    .map((entry) =>
      unpairedEntry(
        unpairedKey(plan.file, side, entry.elementId),
        chainOf(byId.get(entry.elementId)!, byId),
        layout,
        config,
      ),
    );
  return [
    extraction.prelude,
    ...forwardImports(plan.cases, side),
    config.cxFallback
      ? `import { ${config.cxFallback.name} as __cx } from ${JSON.stringify(config.cxFallback.source)};`
      : '',
    NEUTRAL,
    `export const side = ${JSON.stringify(side)};`,
    `export const cases = {\n${entries.join(',\n')}\n};`,
    `export const unpaired = {\n${unpaired.join(',\n')}\n};`,
  ]
    .filter(Boolean)
    .join('\n');
};
