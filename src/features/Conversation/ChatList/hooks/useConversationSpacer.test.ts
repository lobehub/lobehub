import { describe, expect, it } from 'vitest';

import { calculateConversationSpacerHeight, CONVERSATION_SPACER_ID } from './useConversationSpacer';

describe('useConversationSpacer helpers', () => {
  it('should calculate the remaining spacer height behind the latest assistant message', () => {
    expect(calculateConversationSpacerHeight(800, 200, 80)).toBe(520);
  });

  it('should clamp spacer height to zero when content already fills the viewport', () => {
    expect(calculateConversationSpacerHeight(800, 300, 600)).toBe(0);
  });

  it('should keep the reserved spacer id stable', () => {
    expect(CONVERSATION_SPACER_ID).toBe('__conversation_spacer__');
  });
});
