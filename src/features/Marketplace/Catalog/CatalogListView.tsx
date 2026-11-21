'use client';

import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode } from 'react';

import AsyncBoundary from '@/components/AsyncBoundary';
import { CatalogRowsSkeleton } from '@/components/Skeleton/MarketplaceCatalog';
import { SkillListVariantProvider } from '@/features/Settings/skill/features/SkillListRow';

import { catalogStyles } from './styles';

interface CatalogListViewProps {
  children: ReactNode;
  empty: ReactNode;
  error?: unknown;
  hasData: boolean;
  isEmpty: boolean;
  loading: boolean;
  onRetry: () => void;
  pagination?: ReactNode;
}

/**
 * Every item of one group (a category, a sort or a search), opened from a
 * group heading: the same two-column rows as the groups, with a way back.
 */
const CatalogListView = memo<CatalogListViewProps>(
  ({ children, empty, error, hasData, isEmpty, loading, onRetry, pagination }) => {
    return (
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
          <SkillListVariantProvider value={'catalog'}>
            <div {...stylex.props(catalogStyles.grid)}>{children}</div>
          </SkillListVariantProvider>
          {pagination}
        </Flexbox>
      </AsyncBoundary>
    );
  },
);

CatalogListView.displayName = 'MarketplaceCatalogListView';

export default CatalogListView;
