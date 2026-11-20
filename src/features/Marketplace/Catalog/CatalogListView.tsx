'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronLeftIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { SkillListVariantProvider } from '@/features/Settings/skill/features/SkillListRow';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { CatalogRowsSkeleton } from './CatalogSection';
import { catalogStyles } from './styles';

const styles = stylex.create({
  title: {
    marginBlock: 0,
    fontSize: cssVar.fontSizeHeading5,
    fontWeight: 600,
    color: cssVar.colorText,
  },
});

interface CatalogListViewProps {
  /** The grouped Discover page this list narrows. */
  backTo: string;
  children: ReactNode;
  empty: ReactNode;
  error?: unknown;
  hasData: boolean;
  isEmpty: boolean;
  loading: boolean;
  onRetry: () => void;
  pagination?: ReactNode;
  title: string;
}

/**
 * Every item of one group (a category, a sort or a search), opened from a
 * group heading: the same two-column rows as the groups, with a way back.
 */
const CatalogListView = memo<CatalogListViewProps>(
  ({ backTo, children, empty, error, hasData, isEmpty, loading, onRetry, pagination, title }) => {
    const { t } = useTranslation('discover');
    const navigate = useWorkspaceAwareNavigate();

    return (
      <Flexbox gap={12} width={'100%'}>
        <Flexbox horizontal align={'center'} gap={4} paddingInline={4}>
          <ActionIcon
            icon={ChevronLeftIcon}
            size={'small'}
            title={t('catalog.back')}
            onClick={() => navigate(backTo)}
          />
          <h3 {...stylex.props(styles.title)}>{title}</h3>
        </Flexbox>
        <AsyncBoundary
          data={hasData || undefined}
          empty={empty}
          error={error}
          errorVariant={'page'}
          isEmpty={isEmpty}
          isLoading={loading}
          loading={<CatalogRowsSkeleton count={12} />}
          onRetry={onRetry}
        >
          <Flexbox gap={32} width={'100%'}>
            <SkillListVariantProvider value={'page'}>
              <div {...stylex.props(catalogStyles.grid)}>{children}</div>
            </SkillListVariantProvider>
            {pagination}
          </Flexbox>
        </AsyncBoundary>
      </Flexbox>
    );
  },
);

CatalogListView.displayName = 'MarketplaceCatalogListView';

export default CatalogListView;
