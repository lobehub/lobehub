import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Globe } from 'lucide-react';
import { memo } from 'react';

import type { BrowserPageState } from '../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding-block: 6px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;
  `,
  url: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

/** Compact "acted on this page" row used by navigate/click/fill/press/scroll. */
const PageAction = memo<BuiltinRenderProps<unknown, BrowserPageState, string>>(
  ({ content, pluginState }) => {
    return (
      <Flexbox className={styles.container} gap={2}>
        <Flexbox horizontal align={'center'} gap={6}>
          <Globe size={14} />
          <Text ellipsis>{content || pluginState?.title || 'Browser action'}</Text>
        </Flexbox>
        {pluginState?.url && (
          <Text ellipsis className={styles.url}>
            {pluginState.url}
          </Text>
        )}
      </Flexbox>
    );
  },
);

PageAction.displayName = 'BrowserPageAction';

export default PageAction;
