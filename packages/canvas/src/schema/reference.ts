import { CANVAS_COMPONENTS } from './components';
import type { CanvasAttributeSpec, CanvasComponentCategory, CanvasComponentSpec } from './types';

const CATEGORY_TITLES: Record<CanvasComponentCategory, string> = {
  chart: 'Charts',
  control: 'Controls',
  data: 'Data',
  layout: 'Layout',
  text: 'Text',
};

const CATEGORY_ORDER: CanvasComponentCategory[] = ['layout', 'text', 'data', 'control', 'chart'];

const describeType = (spec: CanvasAttributeSpec) =>
  spec.type === 'enum' ? `one of: ${spec.values?.join(' | ')}` : spec.type;

const renderComponent = (spec: CanvasComponentSpec) => {
  const lines = [`### <${spec.tag}>`, '', spec.description];
  if (spec.parents) lines.push(`Only inside ${spec.parents.map((p) => `<${p}>`).join(', ')}.`);

  const attributes = Object.entries(spec.attributes);
  if (attributes.length > 0) {
    lines.push('');
    for (const [name, attr] of attributes) {
      lines.push(
        `- \`${name}\` (${describeType(attr)}${attr.required ? ', required' : ''}): ${attr.description}`,
      );
    }
  }

  lines.push('', '```html', spec.example, '```');
  return lines.join('\n');
};

export const buildCanvasComponentReference = () =>
  CATEGORY_ORDER.map((category) =>
    [
      `## ${CATEGORY_TITLES[category]}`,
      ...CANVAS_COMPONENTS.filter((spec) => spec.category === category).map(renderComponent),
    ].join('\n\n'),
  ).join('\n\n');
