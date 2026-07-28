import { describe, expect, it } from 'vitest';

import { getNotificationWrapperStyle } from './style';

describe('getNotificationWrapperStyle', () => {
  it('reserves trailing space for the close button', () => {
    expect(getNotificationWrapperStyle(true)).toEqual({ paddingInlineEnd: 52 });
  });
});
