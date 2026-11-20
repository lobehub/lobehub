import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import AsyncError from '@/components/AsyncError';

import Loading from './Loading';
import { type LoadMoreFooterState } from './loadMoreFooterState';
import { type ViewMode } from './ViewModeSwitcher';

interface LoadMoreFooterProps {
  loadMoreError?: unknown;
  onRetry?: () => void;
  rows?: number;
  state: LoadMoreFooterState;
  viewMode: ViewMode;
}

/** Footer of a paginated memory list: page loading rows or an inline retry. */
const LoadMoreFooter = memo<LoadMoreFooterProps>(
  ({ loadMoreError, onRetry, rows, state, viewMode }) => {
    if (state === 'loading') return <Loading rows={rows} viewMode={viewMode} />;
    if (state !== 'error') return null;

    return (
      <Flexbox align={'center'} paddingBlock={12}>
        <AsyncError error={loadMoreError} variant={'inline'} onRetry={onRetry} />
      </Flexbox>
    );
  },
);

export default LoadMoreFooter;
