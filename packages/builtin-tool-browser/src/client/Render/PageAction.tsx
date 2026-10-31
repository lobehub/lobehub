import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { Globe } from 'lucide-react';
import { memo } from 'react';

import type { BrowserPageState } from '../../types';

const styles = stylex.create({ container: { paddingBlock: "6px", paddingInline: "10px", borderWidth: "1px", borderStyle: "solid", borderColor: cssVar.colorBorderSecondary, borderRadius: "8px" }, url: { fontSize: "12px", color: cssVar.colorTextTertiary } });

/** Compact "acted on this page" row used by navigate/click/fill/press/scroll/setViewport. */
const PageAction = memo<BuiltinRenderProps<unknown, BrowserPageState, string>>(
  ({ content, pluginState }) => {
    return (
      <Flexbox className={stylex.props(styles.container).className} gap={2}>
        <Flexbox horizontal align={'center'} gap={6}>
          <Globe size={14} />
          <Text ellipsis>{content || pluginState?.title || 'Browser action'}</Text>
        </Flexbox>
        {pluginState?.url && (
          <Text ellipsis className={stylex.props(styles.url).className}>
            {pluginState.url}
          </Text>
        )}
      </Flexbox>
    );
  },
);

PageAction.displayName = 'BrowserPageAction';

export default PageAction;
