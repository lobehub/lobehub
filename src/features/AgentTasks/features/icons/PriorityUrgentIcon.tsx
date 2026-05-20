'use client';

import type { IconType } from '@lobehub/icons';
import { memo } from 'react';

const Icon: IconType = memo(({ size = '1em', style, ...rest }) => {
  return (
    <svg
      fill="currentColor"
      fillRule="evenodd"
      height={size}
      style={{ flex: 'none', lineHeight: 1, ...style }}
      viewBox="0 0 16 16"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      <path d="M3 1c-1.09 0-2 .91-2 2v10c0 1.09.91 2 2 2h10c1.09 0 2-.91 2-2V3c0-1.09-.91-2-2-2H3zm4 3h2l-.246 4.998H7.25L7 4zm2 7a1 1 0 11-2 0 1 1 0 012 0z" />
    </svg>
  );
});

export default Icon;
