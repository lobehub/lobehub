'use client';

import { type IconType } from '@lobehub/icons';
import { memo } from 'react';

const Icon: IconType = memo(({ size = '1em', style, ...rest }) => {
  return (
    <svg
      fill="currentColor"
      fillRule="evenodd"
      height={size}
      style={{ flex: 'none', lineHeight: 1, ...style }}
      viewBox="0 0 41 41"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      <path d="M0 .169l.084 20 .068 16a4 4 0 004.017 3.982l16-.067 10-.042 1.016-.005c2.203-.009 3.983-1.834 3.983-4.037H37v4h3.168L40 0 21.6.078l.077 15.94V26H18.4l.077-9.968L18.4.092 0 .168z" />
    </svg>
  );
});

export default Icon;
