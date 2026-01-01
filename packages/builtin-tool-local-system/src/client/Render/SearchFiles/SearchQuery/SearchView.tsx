import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { SearchIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles';

const styles = createStaticStyles(({ css, cssVar }) => ({
  font: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  query: css`
    cursor: pointer;

    padding-block: 4px;
    padding-inline: 8px;
    border-radius: 8px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

interface SearchBarProps {
  defaultQuery: string;
  onEditingChange: (editing: boolean) => void;
  resultsNumber: number;
  searching?: boolean;
}

const SearchBar = memo<SearchBarProps>(
  ({ defaultQuery, resultsNumber, onEditingChange, searching }) => {
    const { t } = useTranslation('tool');
    return (
      <Flexbox align={'center'} distribution={'space-between'} gap={40} height={26} horizontal>
        <Flexbox
          align={'center'}
          className={cx(styles.query, searching && shinyTextStyles.shinyText)}
          gap={8}
          horizontal
          onClick={() => {
            onEditingChange(true);
          }}
        >
          <Icon icon={SearchIcon} />
          {defaultQuery}
        </Flexbox>

        <Flexbox align={'center'} className={styles.font} horizontal>
          <div>{t('search.searchResult')}</div>
          {resultsNumber}
        </Flexbox>
      </Flexbox>
    );
  },
);
export default SearchBar;
