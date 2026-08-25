import Module from 'node:module';

type ModuleLoad = (request: string, ...rest: unknown[]) => unknown;
type ModuleInternals = { _load: ModuleLoad & { canvasBlocked?: boolean } };

const CANVAS_PACKAGE = '@napi-rs/canvas';

/**
 * pdfjs-dist unconditionally `require()`s `@napi-rs/canvas` — a 25MB Skia binary
 * that only its rendering paths need. We extract text, never render, and install a
 * pure-JS DOMMatrix instead. Blocking resolution keeps the suite honest: if that
 * polyfill ever regresses, PDF tests fail here rather than in a packaged app.
 */
const moduleInternals = Module as unknown as ModuleInternals;
const originalLoad = moduleInternals._load;

if (!originalLoad.canvasBlocked) {
  function blockCanvas(this: unknown, request: string, ...rest: unknown[]) {
    if (request === CANVAS_PACKAGE || request.startsWith(`${CANVAS_PACKAGE}/`)) {
      const error: NodeJS.ErrnoException = new Error(`Cannot find module '${request}'`);
      error.code = 'MODULE_NOT_FOUND';
      throw error;
    }

    return originalLoad.call(this, request, ...rest);
  }

  blockCanvas.canvasBlocked = true;
  moduleInternals._load = blockCanvas;
}
