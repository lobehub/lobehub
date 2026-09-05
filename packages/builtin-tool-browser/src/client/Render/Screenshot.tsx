import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Image } from '@lobehub/ui';
import { memo } from 'react';

import type { BrowserScreenshotState } from '../../types';
import { resolveScreenshotSrc } from './screenshotSrc';

/** Screenshot: render the capture inline for the user. */
const Screenshot = memo<BuiltinRenderProps<unknown, BrowserScreenshotState, string>>(
  ({ pluginState }) => {
    const src = resolveScreenshotSrc(pluginState);
    if (!src) return null;

    return (
      <Block style={{ overflow: 'hidden', padding: 4 }} variant={'outlined'}>
        <Image alt={'Browser screenshot'} src={src} style={{ borderRadius: 4, width: '100%' }} />
      </Block>
    );
  },
);

Screenshot.displayName = 'BrowserScreenshot';

export default Screenshot;
