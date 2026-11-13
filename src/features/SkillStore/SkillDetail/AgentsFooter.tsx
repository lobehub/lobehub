'use client';

import { Button, Flexbox, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import VirtuosoLoading from './VirtuosoLoading';

/** What the "agents using this plugin" grid footer needs, passed as Virtuoso `context`. */
export interface AgentsFooterContext {
  isLoadingMore: boolean;
  /** Copy shown beside Retry when a later page failed. */
  message: string;
  onRetry: () => void;
  pageError?: unknown;
}

/**
 * Footer of the agents grids: a spinner while the next page loads, and an
 * inline retry when a later page failed, so the loaded agents stay on screen.
 */
const AgentsFooter = ({ context }: { context?: AgentsFooterContext }) => {
  const { t } = useTranslation('common');

  if (context?.isLoadingMore) return <VirtuosoLoading />;
  if (context?.pageError)
    return (
      <Flexbox horizontal align={'center'} gap={8} justify={'center'} padding={16}>
        <Text type={'secondary'}>{context.message}</Text>
        <Button onClick={context.onRetry}>{t('retry')}</Button>
      </Flexbox>
    );
  return <div style={{ height: 16 }} />;
};

export default AgentsFooter;
