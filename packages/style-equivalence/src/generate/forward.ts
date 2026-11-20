import type { ForwardApplication, ForwardElement } from '../extract/forward';
import type { PlanCase, Side } from '../plan/planFile';
import { keepLiteral, renderLiteral, SAMPLE_TEXT, VOID_TAGS } from './literal';

const STYLEX = '__stylex';

const tagOf = (element: ForwardElement) =>
  element.tagImport ? `__forward_${element.tagImport.imported}` : element.tag;

export const applicationOf = (application: ForwardApplication, expr: string) => {
  if (application === 'className') return `className={${expr}}`;
  if (application === 'spread') return `{...${STYLEX}.props(${expr})}`;
  return `className={${STYLEX}.props(${expr}).className}`;
};

export const renderForward = (id: string, element: ForwardElement, application?: string) => {
  const tag = tagOf(element);
  const attributes = [`data-synthetic-element=${JSON.stringify(id)}`];
  for (const [name, value] of Object.entries(element.attributes))
    if (keepLiteral(name, false)) attributes.push(renderLiteral(name, value));
  if (application) attributes.push(application);
  const open = `<${tag} ${attributes.join(' ')}`;
  return VOID_TAGS.has(tag) ? `${open} />` : `${open}>{${JSON.stringify(SAMPLE_TEXT)}}</${tag}>`;
};

export const forwardImports = (cases: PlanCase[], side: Side) => {
  const lines = new Set<string>();
  for (const entry of cases) {
    const target = entry.forward?.[side];
    if (!target) continue;
    const imported = target.tagImport;
    if (imported && imported.imported !== 'default' && imported.imported !== '*')
      lines.add(
        `import { ${imported.imported} as ${tagOf(target)} } from ${JSON.stringify(imported.source)};`,
      );
    if (side === 'head' && entry.forward!.application !== 'className')
      lines.add(`import * as ${STYLEX} from '@stylexjs/stylex';`);
  }
  return [...lines];
};
