import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ScanText } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { BrowserSnapshotState } from '../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding-block: 6px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;
  `,
  meta: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

/** Snapshot / readPage: show the page identity + element count, not the dump. */
const Snapshot = memo<BuiltinRenderProps<unknown, BrowserSnapshotState, string>>(
  ({ pluginState }) => {
    const { t } = useTranslation('chat');
    const count = pluginState?.snapshot
      ? pluginState.snapshot.split('\n').filter(Boolean).length
      : 0;

    return (
      <Flexbox className={styles.container} gap={2}>
        <Flexbox horizontal align={'center'} gap={6}>
          <ScanText size={14} />
          <Text ellipsis>{pluginState?.title || t('workingPanel.browser.title')}</Text>
        </Flexbox>
        <Text ellipsis className={styles.meta}>
          {pluginState?.url}
          {count > 0 ? ` · ${t('workingPanel.browser.tool.elements', { count })}` : ''}
        </Text>
      </Flexbox>
    );
  },
);

Snapshot.displayName = 'BrowserSnapshot';

export default Snapshot;
