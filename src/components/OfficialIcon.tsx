'use client';

import { type IconType } from '@lobehub/icons';
import { memo } from 'react';

const OfficialIcon: IconType = memo(({ size = 18, style, fill = '#1d9bf0', ...rest }) => {
  return (
    <svg
      fill={fill}
      fillRule="evenodd"
      height={size}
      style={{ flex: 'none', lineHeight: 1, ...style }}
      viewBox="0 0 22 22"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      <path d="M20.396 11a3.487 3.487 0 00-2.008-3.062 3.474 3.474 0 00-.742-3.584 3.474 3.474 0 00-3.584-.742A3.468 3.468 0 0011 1.604a3.463 3.463 0 00-3.053 2.008 3.472 3.472 0 00-1.902-.14c-.635.13-1.22.436-1.69.882a3.461 3.461 0 00-.734 3.584A3.49 3.49 0 001.604 11a3.496 3.496 0 002.017 3.062 3.471 3.471 0 00.733 3.584 3.49 3.49 0 003.584.742A3.487 3.487 0 0011 20.396a3.476 3.476 0 003.062-2.007 3.335 3.335 0 004.326-4.327A3.487 3.487 0 0020.396 11zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" />
    </svg>
  );
});

export default OfficialIcon;
