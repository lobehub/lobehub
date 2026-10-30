import type { CanvasAttributeSpec, CanvasComponentSpec } from '@lobechat/canvas';

export const parseAttributeValue = (
  spec: CanvasAttributeSpec,
  name: string,
  raw: string | null,
) => {
  if (raw === null) return undefined;

  switch (spec.type) {
    case 'boolean': {
      return raw !== 'false';
    }
    case 'number': {
      const value = Number(raw);
      return raw.trim() !== '' && Number.isFinite(value) ? value : undefined;
    }
    case 'enum': {
      return spec.values?.includes(raw) ? raw : undefined;
    }
    case 'json': {
      try {
        return JSON.parse(raw);
      } catch {
        console.warn(`[lobe-canvas] ${name} is not valid JSON`);
        return undefined;
      }
    }
    default: {
      return raw;
    }
  }
};

export interface CanvasChildItem {
  attrs: Record<string, string>;
  label: string;
  nodes: Node[];
  tag: string;
}

export const readJsonChildren = (host: Element) => {
  const data: Record<string, unknown> = {};
  for (const script of host.querySelectorAll(
    ':scope > script[type="application/json"][data-prop]',
  )) {
    const prop = script.getAttribute('data-prop')!;
    try {
      data[prop] = JSON.parse(script.textContent ?? '');
    } catch {
      console.warn(`[lobe-canvas] data-prop="${prop}" script is not valid JSON`);
    }
  }
  return data;
};

export const readChildItems = (host: Element): CanvasChildItem[] =>
  [...host.children]
    .filter((child) => child.tagName.toLowerCase().startsWith('lobe-'))
    .map((child) => ({
      attrs: Object.fromEntries([...child.attributes].map((attr) => [attr.name, attr.value])),
      label: child.textContent?.trim() ?? '',
      nodes: [...child.childNodes],
      tag: child.tagName.toLowerCase(),
    }));

export const jsonSourceAttributes = (spec: CanvasComponentSpec) =>
  Object.entries(spec.attributes)
    .filter(([, attr]) => attr.type === 'json')
    .map(([name]) => `${name}-src`);

export const readProps = (
  host: Element,
  spec: CanvasComponentSpec,
  overrides: Record<string, unknown>,
): Record<string, unknown> => {
  const props: Record<string, unknown> = {};
  for (const [name, attr] of Object.entries(spec.attributes)) {
    const value = parseAttributeValue(attr, name, host.getAttribute(name));
    if (value !== undefined) props[name] = value;
    else if (name in overrides) props[name] = overrides[name];
  }
  return props;
};
