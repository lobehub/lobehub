import type { BuiltinPlaceholderProps, SearchQuery } from '@lobechat/types';
import { cx, Flexbox, Icon, Skeleton } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { SearchIcon } from 'lucide-react';
import { memo } from 'react';

import { useIsMobile } from '@/hooks/useIsMobile';
import { shinyTextStyles } from '@/styles';

const ITEM_HEIGHT = 80;
const ITEM_WIDTH = 160;

const styles = stylex.create({
  query: {
    paddingBlock: '4px',
    paddingInline: '8px',
    borderRadius: '8px',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
    backgroundClip: { 'default': null, ':hover': 'border-box' },
    backgroundSize: { 'default': null, ':hover': 'auto' },
  },
});

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
        <Flexbox
          horizontal
          align={'center'}
          className={cx(stylex.props(styles.query).className, shinyTextStyles.shinyText)}
          gap={8}
        >
          <Icon icon={SearchIcon} />
          {query ? query : <Skeleton height={20} width={40} />}
        </Flexbox>

        <Skeleton height={20} width={40} />
      </Flexbox>
      <Flexbox horizontal gap={12}>
        {['1', '2', '3', '4', '5'].map((id) => (
          <Skeleton height={ITEM_HEIGHT} key={id} radius={8} width={ITEM_WIDTH} />
        ))}
      </Flexbox>
    </Flexbox>
  );
});
