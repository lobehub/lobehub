import { mount } from 'pele';

import { type CanvasMermaidMount, registerCanvasAddon } from './registry';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Long edges route around one side, so a wide diagram's middle is often empty space;
// the topmost node is where reading starts.
const revealStart = (element: HTMLElement) => {
  if (element.scrollWidth <= element.clientWidth) return;
  let start: Element | undefined;
  for (const node of element.querySelectorAll('.pele-node')) {
    if (!start || node.getBoundingClientRect().top < start.getBoundingClientRect().top)
      start = node;
  }
  if (!start) return;
  const box = element.getBoundingClientRect();
  const target = start.getBoundingClientRect();
  element.scrollLeft += target.left + target.width / 2 - (box.left + box.width / 2);
};

export const mountMermaid = (
  element: HTMLElement,
  source: string,
  idPrefix: string,
): CanvasMermaidMount => {
  try {
    const mounted = mount(element, source, { fontSize: 14, idPrefix, zoom: false });
    if (mounted.error) {
      mounted.destroy();
      return { destroy: () => {}, error: messageOf(mounted.error) };
    }
    revealStart(element);
    return { destroy: () => mounted.destroy() };
  } catch (error) {
    return { destroy: () => {}, error: messageOf(error) };
  }
};

if (typeof window !== 'undefined') registerCanvasAddon('mermaid', { mount: mountMermaid });
