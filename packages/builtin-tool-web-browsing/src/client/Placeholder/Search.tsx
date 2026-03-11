import type { BuiltinPlaceholderProps, SearchQuery } from '@lobechat/types';
import { Flexbox, Icon, Skeleton } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { SearchIcon } from 'lucide-react';
import { memo } from 'react';

import { useIsMobile } from '@/hooks/useIsMobile';
import { shinyTextStyles } from '@/styles';

const ITEM_HEIGHT = 80;
const ITEM_WIDTH = 160;

const styles = createStaticStyles(({ css, cssVar }) => ({
  query: cx(
    css`
      padding-block: 4px;
      padding-inline: 8px;
      border-radius: 8px;

      font-size: 12px;
      color: ${cssVar.colorTextSecondary};

      &:hover {
        background: ${cssVar.colorFillTertiary};
      }
    `,
    shinyTextStyles.shinyText,
  ),
}));

export const Search = memo<BuiltinPlaceholderProps<SearchQuery>>(({ args }) => {
  const { query } = args || {};

  const isMobile = useIsMobile();
  return (
    <Flexbox gap={8}>
      <Flexbox
        align={isMobile ? 'flex-start' : 'center'}
        distribution={'space-between'}
        gap={isMobile ? 8 : 40}
        height={isMobile ? undefined : 32}
        horizontal={!isMobile}
      >
        <Flexbox horizontal align={'center'} className={styles.query} gap={8}>
          <Icon icon={SearchIcon} />
          {query ? query : <Skeleton.Block active style={{ height: 20, width: 40 }} />}
        </Flexbox>

        <Skeleton.Block active style={{ height: 20, width: 40 }} />
      </Flexbox>
      <Flexbox horizontal gap={12}>
        {['1', '2', '3', '4', '5'].map((id) => (
          <Skeleton.Button
            active
            key={id}
            style={{ borderRadius: 8, height: ITEM_HEIGHT, width: ITEM_WIDTH }}
          />
        ))}
      </Flexbox>
    </Flexbox>
  );
});
