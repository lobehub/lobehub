import { renderLiteral, SAMPLE_TEXT } from '../generate/literal';
import type { ShapeRequest } from './requests';

export const SHAPE_CLASS = '__style_eq_shape__';
export const SHAPE_SLOT_PREFIX = '__style_eq_shape_slot__';

const importOf = (request: ShapeRequest, name: string) => {
  const source = JSON.stringify(request.component.source);
  return request.component.imported === 'default'
    ? `import ${name} from ${source};`
    : `import { ${request.component.imported} as ${name} } from ${source};`;
};

const probeOf = (request: ShapeRequest, name: string, leaf: boolean) => {
  const attributes = [`className=${JSON.stringify(SHAPE_CLASS)}`];
  if (request.slots.length)
    attributes.push(
      `classNames={${JSON.stringify(Object.fromEntries(request.slots.map((slot) => [slot, `${SHAPE_SLOT_PREFIX}${slot}`])))}}`,
    );
  for (const [prop, value] of Object.entries(request.props))
    attributes.push(renderLiteral(prop, value));
  const open = `<${name} ${attributes.join(' ')}`;
  return leaf ? `${open} />` : `${open}>{${JSON.stringify(SAMPLE_TEXT)}}</${name}>`;
};

export const generateProbeEntry = ({
  hostWrapper,
  requests,
}: {
  hostWrapper: string;
  requests: ShapeRequest[];
}) => {
  const names = requests.map((_, index) => `__shape${index}`);
  return `import { Host } from ${JSON.stringify(hostWrapper)};
import { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
${requests.map((request, index) => importOf(request, names[index])).join('\n')}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <div data-shape-error="" /> : this.props.children;
  }
}

class Ready extends Component {
  componentDidMount() {
    document.getElementById('app')!.setAttribute('data-synthetic-ready', 'true');
  }

  render() {
    return null;
  }
}

document.body.style.margin = '0';
createRoot(document.getElementById('app')!).render(
  <Host>
    <main>
${requests
  .flatMap((request, index) =>
    [false, true].map(
      (leaf) =>
        `      <section ${leaf ? 'data-shape-leaf="" ' : ''}data-shape-probe={${JSON.stringify(request.key)}}><Boundary>${probeOf(request, names[index], leaf)}</Boundary></section>`,
    ),
  )
  .join('\n')}
    </main>
    <Ready />
  </Host>,
);
`;
};
