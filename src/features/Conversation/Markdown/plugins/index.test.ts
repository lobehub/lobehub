import { THINKING_TAG } from '@/const/plugin';

import { markdownElements } from './index';

describe('markdownElements', () => {
  it('should not register raw think tag rendering in conversation markdown', () => {
    expect(markdownElements.map((element) => element.tag)).not.toContain(THINKING_TAG);
  });
});
