import { mergeConfig } from 'vitest/config';

import desktopConfig from '../../vitest.config.mts';

export default mergeConfig(desktopConfig, {
  test: {
    include: ['scripts/core-ota-test/*.integration.mjs'],
    testTimeout: 30_000,
  },
});
