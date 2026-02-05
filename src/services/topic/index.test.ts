import { describe } from 'vitest';

import { testService } from '~test-utils';

import { TopicService } from './index';

describe('TopicService', () => {
  testService(TopicService, { checkAsync: false });
});
