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
      <path d="M3.5 8h-1a1 1 0 00-1 1v4a1 1 0 001 1h1a1 1 0 001-1V9a1 1 0 00-1-1zM8.5 5h-1a1 1 0 00-1 1v7a1 1 0 001 1h1a1 1 0 001-1V6a1 1 0 00-1-1zM13.5 2h-1a1 1 0 00-1 1v10a1 1 0 001 1h1a1 1 0 001-1V3a1 1 0 00-1-1z" />
    </svg>
  );
});

export default Icon;
