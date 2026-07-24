'use client';

import { Empty, Flexbox } from '@lobehub/ui';
import { useModalContext } from '@lobehub/ui/base-ui';
import { SearchX } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useDiscoverStore } from '@/store/discover';
import { type DiscoverSkillDetail } from '@/types/discover';

import { DetailActionContext, DetailProvider } from './DetailProvider';
import Details from './Details';
import Header from './Header';
import Loading from './Loading';
import { type SkillNavKey } from './types';

interface SkillDetailViewProps {
  activeTab?: SkillNavKey;
  data: DiscoverSkillDetail;
  mobile?: boolean;
  onTabChange?: (tab: SkillNavKey) => void;
}

/** Pure view over an already-fetched detail — shared by the modal and the standalone page. */
export const SkillDetailView = memo<SkillDetailViewProps>(
  ({ data, mobile, activeTab, onTabChange }) => {
    return (
      <DetailProvider config={data}>
        <Flexbox gap={24} width={'100%'}>
          <Header mobile={mobile} />
          <Details activeTab={activeTab} mobile={mobile} onTabChange={onTabChange} />
        </Flexbox>
      </DetailProvider>
    );
  },
);

interface SkillDetailContentProps {
  identifier: string;
  mobile?: boolean;
}

/**
 * Self-fetching detail used as the modal body. Clicking a related skill swaps
 * the content in place instead of stacking another modal.
 */
export const SkillDetailContent = memo<SkillDetailContentProps>(
  ({ identifier: initialIdentifier, mobile }) => {
    const { t } = useTranslation('error');
    const [identifier, setIdentifier] = useState(initialIdentifier);
    const { close } = useModalContext();

    const useSkillDetail = useDiscoverStore((s) => s.useFetchSkillDetail);
    const { data, error, isLoading, isValidating, mutate } = useSkillDetail({ identifier });

    const actions = useMemo(() => ({ close, selectSkill: setIdentifier }), [close]);

    if (isLoading) return <Loading />;
    // A failed fetch is not "skill doesn't exist" — offer a retry instead
    if (error)
      return (
        <AsyncError
          error={error}
          retrying={isValidating}
          variant={'page'}
          onRetry={() => mutate()}
        />
      );
    if (!data)
      return (
        <Flexbox align={'center'} justify={'center'} paddingBlock={80}>
          <Empty description={t('notFound.title')} icon={SearchX} />
        </Flexbox>
      );

    return (
      <DetailActionContext value={actions}>
        <SkillDetailView data={data} key={identifier} mobile={mobile} />
      </DetailActionContext>
    );
  },
);
