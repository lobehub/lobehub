import { cx, Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { SearchIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles';

const styles = stylex.create({
  font: { fontSize: '12px', color: cssVar.colorTextTertiary },
  query: {
    paddingBlock: '4px',
    paddingInline: '8px',
    borderRadius: '8px',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
  },
});

interface SearchBarProps {
  defaultQuery: string;
  resultsNumber: number;
  searching?: boolean;
}

const SearchBar = memo<SearchBarProps>(({ defaultQuery, resultsNumber, searching }) => {
  const { t } = useTranslation('tool');
  return (
    <Flexbox horizontal align={'center'} distribution={'space-between'} gap={40} height={26}>
      <Flexbox horizontal align={'center'} className={stylex.props(styles.query).className} gap={8}>
        <Icon icon={SearchIcon} />
        <span className={cx(searching && shinyTextStyles.shinyText)}>{defaultQuery}</span>
      </Flexbox>

      <Flexbox horizontal align={'center'} className={stylex.props(styles.font).className}>
        <div>{t('search.searchResult')}</div>
        {resultsNumber}
      </Flexbox>
    </Flexbox>
  );
});
export default SearchBar;
