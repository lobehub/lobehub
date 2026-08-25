import * as Comlink from 'comlink';

import type { PythonWorkerType } from './worker';

let interpreter: Comlink.Remote<PythonWorkerType> | undefined;
let constructionError: unknown;
let resolved = false;

// Call this from inside the operation that needs the interpreter, never at module
// scope. `new Worker` throws synchronously — a cross-origin script URL and a CSP
// that forbids workers both do it — and an exception raised while a module
// evaluates propagates to every importer, so a module-scope call turns an
// unavailable Python interpreter into a blank app.
//
// `undefined` means the platform has no workers at all; a construction failure is
// remembered and replayed to every caller, because a swallowed one leaves the
// caller unable to tell a blocked interpreter from a successful run.
export const getPythonInterpreter = (): Comlink.Remote<PythonWorkerType> | undefined => {
  if (!resolved) {
    resolved = true;

    if (typeof Worker !== 'undefined') {
      try {
        // Classic, not a module worker: `worker.ts` loads Pyodide through
        // `importScripts`, and that call throws "Module scripts don't support
        // importScripts()" under `type: 'module'`. The bundler emits this worker as
        // an IIFE anyway, so the module type was never matched by the output.
        interpreter = Comlink.wrap<PythonWorkerType>(
          new Worker(new URL('worker.ts', import.meta.url)),
        );
      } catch (error) {
        constructionError = error;
      }
    }
  }

  if (constructionError) throw constructionError;

  return interpreter;
};
