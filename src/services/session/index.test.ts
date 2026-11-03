import { describe } from 'vitest';

import { testService } from '~test-utils';

import { SessionService } from './index';

describe('SessionService', () => {
  testService(SessionService, { checkAsync: false });
});
