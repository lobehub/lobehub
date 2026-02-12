import * as Comlink from 'comlink';

import type { PythonWorkerType } from './worker';

export const PythonInterpreter = (() => {
  if (typeof Worker !== 'undefined') {
    const worker = new Worker(new URL('worker.ts', import.meta.url), {
      type: 'module',
    });
    return Comlink.wrap<PythonWorkerType>(worker);
  }
  return undefined;
})();
