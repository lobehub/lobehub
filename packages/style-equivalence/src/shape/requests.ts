import type { ComponentImport, FileExtraction, LiteralValue, StyleElement } from '../extract';
import { counterparts, elementsOf } from '../plan/descendants';
import type { FilePlan } from '../plan/planFile';
import { requestedSlots, shapeKey } from '../plan/shapes';

export interface ShapeRequest {
  component: ComponentImport;
  key: string;
  props: Record<string, LiteralValue>;
  slots: string[];
}

export interface ShapeSource {
  extractions: Record<string, Record<'base' | 'head', FileExtraction>>;
  plans: FilePlan[];
}

export const isPackage = (source: string, aliases: Record<string, string>) =>
  !source.startsWith('.') &&
  !source.startsWith('/') &&
  !Object.keys(aliases).some((prefix) => source.startsWith(prefix));

export const shapeRequests = (synthesis: ShapeSource, aliases: Record<string, string>) => {
  const requests = new Map<string, ShapeRequest>();
  const add = (element: StyleElement, slots: string[]) => {
    const { component } = element;
    if (!component || !isPackage(component.source, aliases)) return;
    const key = shapeKey(component, element.literalProps);
    const entry = requests.get(key) ?? { component, key, props: element.literalProps, slots: [] };
    entry.slots = [...new Set([...entry.slots, ...slots])].sort();
    requests.set(key, entry);
  };
  for (const plan of synthesis.plans) {
    const extraction = synthesis.extractions[plan.file];
    if (!extraction) continue;
    const byId = {
      base: new Map(elementsOf(extraction.base).map((element) => [element.id, element])),
      head: new Map(elementsOf(extraction.head).map((element) => [element.id, element])),
    };
    const pairs = plan.cases.flatMap((entry): Array<[StyleElement, StyleElement]> => {
      const left = byId.base.get(entry.elementIds.base);
      const right = byId.head.get(entry.elementIds.head);
      return left && right ? [[left, right]] : [];
    });
    const lookup = counterparts(extraction.base, extraction.head, pairs);
    const unpaired = new Set(
      plan.unpaired.flatMap(({ elementId, side }) => (side === 'head' ? [elementId] : [])),
    );
    const candidates = [...byId.head.values()].flatMap((element) => {
      const wrapped = element.wraps ? byId.head.get(element.wraps) : undefined;
      if (wrapped)
        return unpaired.has(wrapped.id)
          ? [
              {
                effective: { ...element, bindings: wrapped.bindings, component: wrapped.component },
                element,
              },
            ]
          : [];
      return unpaired.has(element.id) ? [{ effective: element, element }] : [];
    });
    for (const { effective, element } of candidates) {
      const found = lookup(element);
      if (!found?.counterpart.component || !effective.component) continue;
      add(effective, requestedSlots(effective));
      for (const id of found.parent.children ?? []) {
        const child = byId.base.get(id);
        if (child && !/^[a-z]/.test(child.tag)) add(child, []);
      }
    }
  }
  return [...requests.values()];
};
