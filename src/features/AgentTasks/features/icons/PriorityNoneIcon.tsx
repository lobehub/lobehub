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
      <path
        d="M4 7.25H2a.5.5 0 00-.5.5v.5a.5.5 0 00.5.5h2a.5.5 0 00.5-.5v-.5a.5.5 0 00-.5-.5zM9 7.25H7a.5.5 0 00-.5.5v.5a.5.5 0 00.5.5h2a.5.5 0 00.5-.5v-.5a.5.5 0 00-.5-.5zM14 7.25h-2a.5.5 0 00-.5.5v.5a.5.5 0 00.5.5h2a.5.5 0 00.5-.5v-.5a.5.5 0 00-.5-.5z"
        opacity=".9"
      />
    </svg>
  );
});

export default Icon;
