'use client';

import type { ProjectCompletionDecision, ProjectStatus } from '@lobechat/types';
import { Block, Empty, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { BadgeCheckIcon, Clock3Icon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { projectService } from '@/services/project';
import { useCurrentProjectDetail, useProjectStore } from '@/store/project';

import { getProjectAcceptanceActions, type ProjectAcceptanceAction } from './actions';
import { openRejectProjectModal } from './RejectModal';

const PROJECT_STATUS_KEYS: Record<ProjectStatus, `acceptance.status.${ProjectStatus}`> = {
  active: 'acceptance.status.active',
  archived: 'acceptance.status.archived',
  backlog: 'acceptance.status.backlog',
  canceled: 'acceptance.status.canceled',
  completed: 'acceptance.status.completed',
  paused: 'acceptance.status.paused',
  reviewing: 'acceptance.status.reviewing',
};

const PROJECT_DECISION_KEYS: Record<
  ProjectCompletionDecision,
  `acceptance.decision.${ProjectCompletionDecision}`
> = {
  accepted: 'acceptance.decision.accepted',
  rejected: 'acceptance.decision.rejected',
};

const ProjectAcceptance = memo(() => {
  const { t } = useTranslation('project');
  const { projectId } = useActiveRouteParams<{ projectId: string }>();
  const id = projectId ?? '';
  const detail = useCurrentProjectDetail(id);
  const detailSWR = useProjectStore((s) => s.useFetchProjectDetail)(projectId);
  const [loadingAction, setLoadingAction] = useState<ProjectAcceptanceAction>();

  if (detailSWR.error)
    return <AsyncError error={detailSWR.error} variant={'page'} onRetry={detailSWR.mutate} />;
  if (!detail)
    return (
      <Flexbox align={'center'} flex={1} justify={'center'}>
        <NeuralNetworkLoading />
      </Flexbox>
    );

  const actions = getProjectAcceptanceActions(detail.project.status);
  const completionReviews = detail.completionReviews ?? [];
  const execute = async (action: Exclude<ProjectAcceptanceAction, 'reject'>) => {
    setLoadingAction(action);
    try {
      if (action === 'start') await projectService.updateStatus(id, 'active');
      if (action === 'requestCompletion') await projectService.requestCompletion(id);
      if (action === 'accept') await projectService.acceptCompletion(id);
      if (action === 'reopen') await projectService.reopen(id);
      await detailSWR.mutate();
      toast.success(t(`acceptance.success.${action}`));
    } catch {
      toast.error(t('acceptance.operationFailed'));
    } finally {
      setLoadingAction(undefined);
    }
  };

  const reject = () =>
    openRejectProjectModal(async (comment) => {
      await projectService.rejectCompletion(id, comment);
      await detailSWR.mutate();
      toast.success(t('acceptance.success.reject'));
    });

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader left={<Text weight={600}>{t('acceptance.title')}</Text>} />
      <WideScreenContainer
        flex={1}
        gap={20}
        paddingBlock={24}
        wrapperStyle={{ flex: 1, overflowY: 'auto' }}
      >
        <Flexbox gap={4}>
          <Text fontSize={24} weight={650}>
            {t('acceptance.title')}
          </Text>
          <Text type={'secondary'}>{t('acceptance.description')}</Text>
        </Flexbox>
        <Block padding={20} variant={'filled'}>
          <Flexbox horizontal align={'center'} gap={16} justify={'space-between'} wrap={'wrap'}>
            <Flexbox horizontal align={'center'} gap={12}>
              <Icon icon={BadgeCheckIcon} size={24} />
              <Flexbox gap={2}>
                <Text weight={600}>{t('acceptance.currentStatus')}</Text>
                <Text type={'secondary'}>{t(PROJECT_STATUS_KEYS[detail.project.status])}</Text>
              </Flexbox>
            </Flexbox>
            <Flexbox horizontal gap={8}>
              {actions.map((action) => (
                <Button
                  key={action}
                  loading={loadingAction === action}
                  type={
                    action === 'accept' || action === 'requestCompletion' ? 'primary' : undefined
                  }
                  onClick={() => (action === 'reject' ? reject() : void execute(action))}
                >
                  {t(`acceptance.actions.${action}`)}
                </Button>
              ))}
            </Flexbox>
          </Flexbox>
        </Block>
        <Flexbox gap={10}>
          <Text fontSize={16} weight={600}>
            {t('acceptance.history')}
          </Text>
          {completionReviews.length === 0 ? (
            <Block padding={32} variant={'outlined'}>
              <Empty
                description={t('acceptance.emptyDescription')}
                title={t('acceptance.emptyTitle')}
              />
            </Block>
          ) : (
            completionReviews.map((review) => (
              <Block
                horizontal
                align={'flex-start'}
                gap={12}
                key={review.id}
                padding={16}
                variant={'outlined'}
              >
                <Icon icon={Clock3Icon} />
                <Flexbox gap={4}>
                  <Text weight={600}>
                    {t('acceptance.round', { round: review.round })} ·{' '}
                    {t(PROJECT_DECISION_KEYS[review.decision])}
                  </Text>
                  {review.comment && <Text type={'secondary'}>{review.comment}</Text>}
                </Flexbox>
              </Block>
            ))
          )}
        </Flexbox>
      </WideScreenContainer>
    </Flexbox>
  );
});

ProjectAcceptance.displayName = 'ProjectAcceptance';

export default ProjectAcceptance;
