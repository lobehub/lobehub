import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Image } from '@lobehub/ui';
import { memo } from 'react';

import type { BrowserScreenshotState } from '../../types';

/** Screenshot: render the captured JPEG data URL inline for the user. */
const Screenshot = memo<BuiltinRenderProps<unknown, BrowserScreenshotState, string>>(
  ({ pluginState }) => {
    if (!pluginState?.dataUrl) return null;

    return (
      <Block style={{ overflow: 'hidden', padding: 4 }} variant={'outlined'}>
        <Image
          alt={'Browser screenshot'}
          src={pluginState.dataUrl}
          style={{ borderRadius: 4, width: '100%' }}
        />
      </Block>
    );
  },
);

Screenshot.displayName = 'BrowserScreenshot';

export default Screenshot;
