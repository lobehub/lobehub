import { type SafeAreaProps } from '@lobehub/ui/mobile';
import { SafeArea } from '@lobehub/ui/mobile';
import { memo } from 'react';

import { HEADER_HEIGHT, MOBILE_NABBAR_HEIGHT, MOBILE_TABBAR_HEIGHT } from '@/const/layoutTokens';

interface SafeSpacingProps {
  height?: number;
  mobile?: boolean;
  position?: SafeAreaProps['position'];
}

const SafeSpacing = memo<SafeSpacingProps>(({ height, position = 'top', mobile }) => {
  let h;
  if (mobile) {
    h = position === 'top' ? MOBILE_NABBAR_HEIGHT : MOBILE_TABBAR_HEIGHT;
  } else {
    h = HEADER_HEIGHT;
  }
  return (
    <>
      <div style={{ flex: 'none', height: height || h }} />
      {mobile && <SafeArea position={position} />}
    </>
  );
});

export default SafeSpacing;
