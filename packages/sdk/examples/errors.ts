/** bun examples/errors.ts — the two error-handling styles. */
/* eslint-disable no-console -- examples print their results */
import { createLobeHub, LobeHubAPIError, LobeHubConnectionError } from '@lobehub/sdk';

import { lobehub, options } from './client';

// 1. Default: methods resolve with `{ data, error }`.
const { error } = await lobehub().agents.get({ path: { id: 'agt_does_not_exist' } });
if (error instanceof LobeHubAPIError) {
  console.log('returned:', error.status, error.code, `(request ${error.requestId})`);
}

// 2. throwOnError: methods reject, and `data` is always present on success.
const strict = createLobeHub({ ...options(), throwOnError: true });
try {
  await strict.agents.create({ body: { title: '' } });
} catch (thrown) {
  if (thrown instanceof LobeHubAPIError && thrown.code === 'validation_error') {
    console.log('thrown:', thrown.status, thrown.details);
  } else if (thrown instanceof LobeHubConnectionError) {
    console.log('network trouble:', thrown.message);
  } else {
    throw thrown;
  }
}
