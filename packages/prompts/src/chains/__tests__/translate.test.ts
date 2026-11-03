import { describe, expect, it } from 'vitest';

import { chainTranslate } from '../translate';

describe('chainTranslate', () => {
  it('should create a payload with system and user messages for translation', () => {
    // Arrange
    const content = 'This is a test sentence.';
    const targetLang = 'zh-CN';

    // Act
    const result = chainTranslate(content, targetLang);

    // Assert
    expect(result).toMatchSnapshot();
  });
});
