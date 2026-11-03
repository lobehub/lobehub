import { describe } from 'vitest';

import { testService } from '~test-utils';

import { PluginService } from './index';

describe('PluginService', () => {
  testService(PluginService, { checkAsync: false });
});
