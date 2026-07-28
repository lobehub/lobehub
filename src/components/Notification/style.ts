import type { CSSProperties } from 'react';

export const getNotificationWrapperStyle = (
  showCloseIcon: boolean,
  style?: CSSProperties,
): CSSProperties => ({
  ...(showCloseIcon && { paddingInlineEnd: 52 }),
  ...style,
});
