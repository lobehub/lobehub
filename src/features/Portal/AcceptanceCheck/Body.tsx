'use client';

import type { VerifyAgentPlanConfig } from '@lobechat/types';
import { Center, Empty, Flexbox, Icon } from '@lobehub/ui';
import { Button, Tag, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import {
  checkHeadMeta,
  type CheckReviewInput,
  FocusedCheckDetails,
  useAcceptanceBundle,
} from '@/features/Acceptance';
import { canReviewAcceptance } from '@/features/Acceptance/Viewer/visibility';
import { verifyService } from '@/services/verify';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useTaskStore } from '@/store/task';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow-y: auto;
    flex: 1;

    height: 100%;
    min-height: 0;
    padding-block: 0 24px;
    padding-inline: 24px;
  `,
}));

const Body = memo(() => {
  const { t } = useTranslation(['chat', 'verify']);
  // Task detail (and Home) mount the drawer this opens into.
  const openTopicDrawer = useTaskStore((s) => s.openTopicDrawer);

  const portal = useChatStore(chatPortalSelectors.acceptanceCheckPortal);
  const openAcceptance = useChatStore((state) => state.openAcceptance);
  const { data, error, isLoading, mutate } = useAcceptanceBundle(portal?.acceptanceId ?? null);
  const [reviewPending, setReviewPending] = useState(false);
  const check = data?.checks.find((item) => item.id === portal?.checkId);

  /**
   * An agent judge's argument IS its run, so the trace is the reviewable form
   * of its verdict. The button was already rendered here but received no
   * handler, which made it a dead click.
   */
  const openVerifierTrace = async (verifierOperationId: string) => {
    const resolved = await verifyService.getVerifierThread(verifierOperationId);
    if (!resolved?.topicId) return;
    openTopicDrawer(resolved.topicId, {
      title: t('acceptance.checks.viewTrace', { ns: 'verify' }),
    });
  };

  const handleReview = async (input: CheckReviewInput): Promise<boolean> => {
    if (!data) return false;

    try {
      setReviewPending(true);
      await verifyService.reviewChecks({ id: data.acceptance.id, ...input });
      await mutate();
      return true;
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('taskDetail.acceptance.reviewError'));
      return false;
    } finally {
      setReviewPending(false);
    }
  };

  if (isLoading) {
    return (
      <Center height={'100%'}>
        <NeuralNetworkLoading size={40} />
      </Center>
    );
  }

  if (error || !data || !check) {
    return (
      <Center height={'100%'}>
        <Flexbox align={'center'} gap={12}>
          <Empty description={t('taskDetail.acceptance.loadError')} />
          <Button onClick={() => void mutate()}>{t('taskDetail.acceptance.retry')}</Button>
        </Flexbox>
      </Center>
    );
  }

  const checkMeta = checkHeadMeta(check);
  const verifierType = check.planItem?.verifierType ?? check.result?.verifierType;
  const planConfig = (check.planItem?.verifierConfig ?? {}) as VerifyAgentPlanConfig;
  const requiredEvidence = planConfig.requiredEvidence ?? [];
  const usesMultimodalLlm = requiredEvidence.some((evidence) => evidence.type === 'screenshot');

  return (
    <Flexbox className={styles.body} gap={16}>
      <Flexbox horizontal align={'center'} gap={10}>
        <Icon color={checkMeta.color} icon={checkMeta.icon} size={18} style={{ flex: 'none' }} />
        <Text fontSize={16} weight={600}>
          C{check.seq} · {check.title}
        </Text>
      </Flexbox>
      {(verifierType || requiredEvidence.length > 0) && (
        <Flexbox horizontal align={'center'} gap={16} wrap={'wrap'}>
          {verifierType && (
            <Flexbox horizontal align={'center'} gap={8}>
              <Text fontSize={12} type={'secondary'}>
                {t('taskDetail.acceptance.verifier')}
              </Text>
              <Tag>{t(`criterion.verifierType.${verifierType}` as const, { ns: 'verify' })}</Tag>
              {usesMultimodalLlm && <Tag>{t('taskDetail.acceptance.multimodalLlm')}</Tag>}
            </Flexbox>
          )}
          {requiredEvidence.length > 0 && (
            <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
              <Text fontSize={12} type={'secondary'}>
                {t('taskDetail.acceptance.requiredEvidence')}
              </Text>
              {requiredEvidence.map((evidence) => (
                <Tag key={evidence.type}>
                  {t(`report.evidence.medium.${evidence.type}` as const, { ns: 'verify' })}
                </Tag>
              ))}
            </Flexbox>
          )}
        </Flexbox>
      )}
      <FocusedCheckDetails
        canReview={canReviewAcceptance(data)}
        check={check}
        reviewPending={reviewPending}
        onOpenTrace={openVerifierTrace}
        onReview={handleReview}
        onRound={() => openAcceptance(data.acceptance.id)}
      />
    </Flexbox>
  );
});

Body.displayName = 'AcceptanceCheckPortalBody';

export default Body;
