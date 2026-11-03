import { describe, expect, it } from 'vitest';

import { chainPickEmoji } from '../pickEmoji';

describe('chainPickEmoji', () => {
  it('should return a payload with the correct structure and embedded user content', () => {
    const result = chainPickEmoji('你是一名星际探索者');

    expect(result).toMatchSnapshot();
  });
});
