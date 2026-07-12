'use client';

import type { IconType } from '@lobehub/icons';
import { memo } from 'react';

/**
 * Linear brand logomark, same path as the Linear tool inspector
 * (packages/shared-tool-ui/src/Inspector/Linear/Inspector.tsx) so Linear
 * work cards stay visually consistent with Linear tool-call rows.
 */
const Icon: IconType = memo(({ size = '1em', style, ...rest }) => {
  return (
    <svg
      fill="currentColor"
      fillRule="evenodd"
      height={size}
      style={{ flex: 'none', lineHeight: 1, ...style }}
      viewBox="0 0 100 100"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      <path d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857l36.5217 36.5208c.6889.6892.0915 1.8191-.857 1.5962C20.0696 93.4248 6.4263 79.7822 1.22541 61.5228ZM.00189 46.8083c-.034026.4081.115306.8067.405562 1.0969l51.683 51.683c.2903.2903.6888.4396 1.0969.4056 2.0035-.16708 3.9669-.49328 5.8741-.96868.7361-.18352.9961-1.0903.4607-1.6256L2.5907 40.4732c-.5353-.5354-1.4421-.2754-1.6256.4607-.475415 1.9072-.801574 3.8706-.968613 5.8744ZM4.21462 29.7355c-.16002.3549-.08227.7719.19288 1.047L69.2174 95.5901c.275.2752.6921.353 1.047.193 1.4913-.6716 2.9332-1.43 4.3197-2.275.5025-.3061.5856-1.0023.1674-1.4205L8.31112 25.279c-.41817-.4181-1.11435-.3349-1.42044.1675-.84572 1.3873-1.60473 2.8284-2.27606 4.319ZM12.6963 18.6088c-.3683-.3684-.3923-.9577-.0469-1.3489C21.7846 6.9544 35.1342 0 50 0c27.6142 0 50 22.3858 50 50 0 14.8669-6.9544 28.2155-17.2598 37.3499-.3912.3461-.9805.3214-1.349-.0469L12.6963 18.6088Z" />
    </svg>
  );
});

export default Icon;
