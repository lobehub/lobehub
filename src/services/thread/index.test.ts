import { describe } from 'vitest';

import { testService } from '~test-utils';

import { ThreadService } from './index';

describe('ThreadService', () => {
  testService(ThreadService, { checkAsync: false });
});
