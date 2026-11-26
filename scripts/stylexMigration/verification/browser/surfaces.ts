export interface CaptureSurface {
  id: string;
  kind: 'component' | 'host' | 'portal';
  selector: string;
  variants?: string[];
}

export interface CaptureRoot {
  keyPrefix: string;
  selector: string;
}

export interface CaptureScope {
  roots: CaptureRoot[];
  surfaces: Array<{ id: string; kind: CaptureSurface['kind']; matches: number }>;
}

/** Serializable browser function. Only declared portal roots extend the scope. */
export const resolveCaptureSurfacesInPage = (input: {
  surfaces: CaptureSurface[];
  variant?: string;
}): CaptureScope => {
  const root = document.querySelector('[data-case-root]');
  if (!root) throw new Error('CAPTURE_ROOT_MISSING');
  const marker = 'data-stylex-verification-surface';
  document.querySelectorAll(`[${marker}]`).forEach((element) => element.removeAttribute(marker));
  const external: Array<{ element: Element; keyPrefix: string }> = [];
  const surfaces = [];
  for (const surface of input.surfaces) {
    if (surface.variants && !surface.variants.includes(input.variant ?? '')) continue;
    let matches: Element[];
    try {
      matches = [...document.querySelectorAll(surface.selector)];
    } catch {
      throw new Error(`SURFACE_SELECTOR_INVALID:${surface.id}`);
    }
    if (!matches.length) throw new Error(`SURFACE_NOT_MOUNTED:${surface.id}`);
    surfaces.push({ id: surface.id, kind: surface.kind, matches: matches.length });
    for (const [index, element] of matches.entries()) {
      if (root.contains(element)) continue;
      if (surface.kind !== 'portal') throw new Error(`SURFACE_OUTSIDE_ROOT:${surface.id}`);
      if (element.contains(root)) throw new Error(`SURFACE_CONTAINS_ROOT:${surface.id}`);
      external.push({ element, keyPrefix: `surface:${encodeURIComponent(surface.id)}:${index}/` });
    }
  }
  // Nested/overlapping declarations are captured once, from their outer root.
  const unique = external.filter(
    (entry, index) =>
      !external.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          other.element.contains(entry.element) &&
          (other.element !== entry.element || otherIndex < index),
      ),
  );
  if (unique.length > 32) throw new Error('CAPTURE_SURFACE_BUDGET_EXCEEDED');
  return {
    roots: [
      { keyPrefix: '', selector: '[data-case-root]' },
      ...unique.map(({ element, keyPrefix }) => {
        element.setAttribute(marker, keyPrefix);
        return { keyPrefix, selector: `[${marker}="${keyPrefix}"]` };
      }),
    ],
    surfaces,
  };
};
