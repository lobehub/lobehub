import { Block, cx, Flexbox, Icon, Skeleton, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { SearchIcon } from 'lucide-react';
import { memo } from 'react';

import { useIsMobile } from '@/hooks/useIsMobile';
import { shinyTextStyles } from '@/styles';

import { EngineAvatarGroup } from '../../../components/EngineAvatar';

const styles = stylex.create({
  query: {
    paddingBlock: '4px',
    paddingInline: '8px',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
  },
});

interface SearchBarProps {
  defaultEngines: string[];
  defaultQuery: string;
  onEditingChange: (editing: boolean) => void;
  resultsNumber: number;
  searching?: boolean;
}

const SearchBar = memo<SearchBarProps>(
  ({ defaultEngines, defaultQuery, resultsNumber, onEditingChange, searching }) => {
    const isMobile = useIsMobile();
    return (
      <Flexbox
        align={isMobile ? 'flex-start' : 'center'}
        distribution={'space-between'}
        gap={isMobile ? 8 : 40}
        height={isMobile ? undefined : 32}
        horizontal={!isMobile}
      >
        <Block
          clickable
          horizontal
          align={'center'}
          className={stylex.props(styles.query).className}
          gap={8}
          variant={'borderless'}
          onClick={() => {
            onEditingChange(true);
          }}
        >
          <Icon icon={SearchIcon} />
          <span className={cx(searching && shinyTextStyles.shinyText)}>{defaultQuery}</span>
        </Block>

        {searching ? (
          <Skeleton height={20} width={40} />
        ) : (
          <Flexbox horizontal align={'center'} gap={4}>
            <EngineAvatarGroup engines={defaultEngines} />
            {!isMobile && (
              <Text style={{ fontSize: 12 }} type={'secondary'}>
                {resultsNumber}
              </Text>
            )}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);
export default SearchBar;
