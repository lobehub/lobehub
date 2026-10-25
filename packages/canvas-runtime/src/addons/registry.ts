export interface CanvasHighlightAddon {
  highlight: (code: string, language?: string) => Promise<string>;
}

export interface CanvasMermaidMount {
  destroy: () => void;
  error?: string;
}

export interface CanvasMermaidAddon {
  mount: (element: HTMLElement, source: string, idPrefix: string) => CanvasMermaidMount;
}

export interface CanvasAddons {
  highlight: CanvasHighlightAddon;
  mermaid: CanvasMermaidAddon;
}

export type CanvasAddonName = keyof CanvasAddons;

declare global {
  interface Window {
    __LOBE_CANVAS_ADDONS__?: Partial<CanvasAddons>;
  }
}

export const registerCanvasAddon = <K extends CanvasAddonName>(name: K, addon: CanvasAddons[K]) => {
  window.__LOBE_CANVAS_ADDONS__ ??= {};
  window.__LOBE_CANVAS_ADDONS__[name] = addon;
};

export const canvasAddonFile = (name: CanvasAddonName) => `canvas-runtime-${name}.js`;
