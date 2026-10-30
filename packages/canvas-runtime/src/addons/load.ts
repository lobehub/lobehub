import { canvasAddonFile, type CanvasAddonName, type CanvasAddons } from './registry';

declare global {
  interface Window {
    __LOBE_CANVAS_LOAD_ADDON__?: (name: CanvasAddonName) => Promise<unknown>;
  }
}

// Captured while the runtime script runs: add-ons sit next to it, and the page's own
// URL points at the user's project, not at the runtime's origin.
const runtimeSrc =
  typeof document !== 'undefined' && document.currentScript instanceof HTMLScriptElement
    ? document.currentScript.src
    : undefined;

const pending = new Map<CanvasAddonName, Promise<unknown>>();

export const resolveCanvasAddonUrl = (name: CanvasAddonName, base = runtimeSrc) =>
  new URL(canvasAddonFile(name), base ?? document.baseURI).href;

export const loadCanvasAddon = <K extends CanvasAddonName>(name: K): Promise<CanvasAddons[K]> => {
  const ready = window.__LOBE_CANVAS_ADDONS__?.[name];
  if (ready) return Promise.resolve(ready as CanvasAddons[K]);

  let promise = pending.get(name);
  if (!promise) {
    if (window.__LOBE_CANVAS_LOAD_ADDON__) {
      promise = window
        .__LOBE_CANVAS_LOAD_ADDON__(name)
        .then(() => {
          const addon = window.__LOBE_CANVAS_ADDONS__?.[name];
          if (!addon) throw new Error(`The ${name} add-on loaded without registering`);
          return addon;
        })
        .catch((error) => {
          pending.delete(name);
          throw error;
        });
      pending.set(name, promise);
      return promise as Promise<CanvasAddons[K]>;
    }
    promise = new Promise<CanvasAddons[K]>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = resolveCanvasAddonUrl(name);
      script.addEventListener('load', () => {
        const addon = window.__LOBE_CANVAS_ADDONS__?.[name];
        if (addon) resolve(addon as CanvasAddons[K]);
        else reject(new Error(`The ${name} add-on loaded without registering`));
      });
      script.addEventListener('error', () => {
        pending.delete(name);
        script.remove();
        reject(new Error(`The ${name} add-on failed to load from ${script.src}`));
      });
      document.head.append(script);
    });
    pending.set(name, promise);
  }
  return promise as Promise<CanvasAddons[K]>;
};
