import * as Comlink from 'comlink';

import type { PythonWorkerType } from './worker';

let interpreter: Comlink.Remote<PythonWorkerType> | undefined;
let resolved = false;

// Constructing the worker while this module evaluates takes the whole import
// graph down with it. `new Worker` throws synchronously — a cross-origin script
// URL and a CSP that forbids workers both do it — and an exception raised during
// module evaluation propagates to every importer, so an unavailable Python
// interpreter blanks the app instead of disabling one feature.
export const getPythonInterpreter = (): Comlink.Remote<PythonWorkerType> | undefined => {
  if (resolved) return interpreter;
  resolved = true;

  if (typeof Worker === 'undefined') return undefined;

  try {
    interpreter = Comlink.wrap<PythonWorkerType>(
      new Worker(new URL('worker.ts', import.meta.url), {
        type: 'module',
      }),
    );
  } catch {
    interpreter = undefined;
  }

  return interpreter;
};
