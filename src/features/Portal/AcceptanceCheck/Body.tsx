'use client';

import { Center, Empty, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import {
  checkHeadMeta,
  type CheckReviewInput,
  FocusedCheckDetails,
  useAcceptanceBundle,
} from '@/features/Verify';
import { verifyService } from '@/services/verify';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow-y: auto;
    padding-block: 0 24px;
    padding-inline: 24px;
  `,
}));

const Body = memo(() => {
  const { t } = useTranslation('chat');
  const { message } = App.useApp();
  const portal = useChatStore(chatPortalSelectors.acceptanceCheckPortal);
  const openAcceptance = useChatStore((state) => state.openAcceptance);
  const { data, error, isLoading, mutate } = useAcceptanceBundle(portal?.acceptanceId ?? null);
  const [reviewPending, setReviewPending] = useState(false);
  const check = data?.checks.find((item) => item.id === portal?.checkId);

  const handleReview = async (input: CheckReviewInput): Promise<boolean> => {
    if (!data) return false;

    try {
      setReviewPending(true);
      await verifyService.reviewChecks({ id: data.acceptance.id, ...input });
      await mutate();
      return true;
    } catch (cause) {
      message.error(
        cause instanceof Error ? cause.message : t('taskDetail.acceptance.reviewError'),
      );
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

  return (
    <Flexbox className={styles.body} gap={16}>
      <Flexbox horizontal align={'center'} gap={10}>
        <Icon color={checkMeta.color} icon={checkMeta.icon} size={18} style={{ flex: 'none' }} />
        <Text fontSize={16} weight={600}>
          C{check.seq} · {check.title}
        </Text>
      </Flexbox>
      <FocusedCheckDetails
        canReview={data.isOwner}
        check={check}
        reviewPending={reviewPending}
        onReview={handleReview}
        onRound={() => openAcceptance(data.acceptance.id)}
      />
    </Flexbox>
  );
});

Body.displayName = 'AcceptanceCheckPortalBody';

export default Body;
