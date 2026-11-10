import {
  Button,
  confirmModal,
  copyToClipboard,
  Flexbox,
  Icon,
  Input,
  Switch,
  Text,
  toast,
} from '@lobehub/ui';
import { CopyIcon, GlobeIcon, LockIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ArticleSkeleton } from '@/components/Skeleton';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { goalSelectors, useGoalStore } from '@/store/goal';

interface GoalSharePopoverProps {
  goalId: string;
}

const GoalSharePopover = memo<GoalSharePopoverProps>(({ goalId }) => {
  const { t } = useTranslation(['chat', 'common']);
  const appOrigin = useAppOrigin();
  const [busy, setBusy] = useState(false);

  const useFetchGoalShare = useGoalStore((s) => s.useFetchGoalShare);
  const enableGoalShare = useGoalStore((s) => s.enableGoalShare);
  const setGoalShareVisibility = useGoalStore((s) => s.setGoalShareVisibility);
  const disableGoalShare = useGoalStore((s) => s.disableGoalShare);
  const share = useGoalStore(goalSelectors.goalShare(goalId));
  const { error, isLoading, mutate } = useFetchGoalShare(goalId);

  const shareUrl = share ? `${appOrigin}/share/goal/${share.id}` : '';
  const isLinkShared = share?.visibility === 'link';

  const copyLink = useCallback(
    async (url: string) => {
      await copyToClipboard(url);
      toast.success(t('shareModal.copyLinkSuccess'));
    },
    [t],
  );

  const toggleLink = useCallback(
    async (checked: boolean) => {
      setBusy(true);
      try {
        const visibility = checked ? 'link' : 'private';
        if (share) await setGoalShareVisibility(goalId, visibility);
        else await enableGoalShare(goalId, visibility);
        const next = goalSelectors.goalShare(goalId)(useGoalStore.getState());
        // The link is only useful once it is on the clipboard, so copy it the moment it opens up.
        if (checked && next) await copyLink(`${appOrigin}/share/goal/${next.id}`);
        else toast.success(t('goalDetail.share.visibilityUpdated'));
      } catch {
        toast.error(t('goalDetail.share.updateError'));
      } finally {
        setBusy(false);
      }
    },
    [appOrigin, copyLink, enableGoalShare, goalId, setGoalShareVisibility, share, t],
  );

  const stopSharing = useCallback(() => {
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('goalDetail.share.stopConfirm.content'),
      okButtonProps: { danger: true },
      okText: t('goalDetail.share.stopConfirm.ok'),
      onOk: async () => {
        try {
          await disableGoalShare(goalId);
          toast.success(t('goalDetail.share.stopped'));
        } catch {
          toast.error(t('goalDetail.share.updateError'));
        }
      },
      title: t('goalDetail.share.stopConfirm.title'),
    });
  }, [disableGoalShare, goalId, t]);

  // A failed first read must not read as "not shared": offering to create a link
  // over a record we could not see would hide the real state.
  if (error && share === undefined) {
    return (
      <Flexbox gap={8} padding={16}>
        <Text strong>{t('goalDetail.share.title')}</Text>
        <Text type={'secondary'}>{t('goalDetail.share.loadError')}</Text>
        <Flexbox horizontal justify={'flex-end'}>
          <Button size={'small'} type={'text'} onClick={() => void mutate()}>
            {t('retry', { ns: 'common' })}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  }

  if (isLoading && share === undefined) {
    return (
      <Flexbox gap={16} padding={16}>
        <Text strong>{t('goalDetail.share.title')}</Text>
        <ArticleSkeleton rows={2} />
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={12} padding={16}>
      <Text strong>{t('goalDetail.share.title')}</Text>
      <Flexbox horizontal align={'center'} gap={10}>
        <Icon icon={isLinkShared ? GlobeIcon : LockIcon} size={18} />
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <Text strong>{t('goalDetail.share.linkShare')}</Text>
          <Text fontSize={12} type={'secondary'}>
            {isLinkShared ? t('goalDetail.share.linkOn') : t('goalDetail.share.linkOff')}
          </Text>
        </Flexbox>
        <Switch
          aria-label={t('goalDetail.share.linkShare')}
          checked={isLinkShared}
          disabled={busy}
          loading={busy}
          onChange={(checked) => void toggleLink(checked)}
        />
      </Flexbox>

      {isLinkShared && shareUrl && (
        <Flexbox horizontal gap={6}>
          <Input
            readOnly
            aria-label={t('shareModal.link')}
            value={shareUrl}
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button icon={CopyIcon} type={'primary'} onClick={() => void copyLink(shareUrl)}>
            {t('copy', { ns: 'common' })}
          </Button>
        </Flexbox>
      )}

      <Text fontSize={12} type={'secondary'}>
        {t('goalDetail.share.scopeNote')}
      </Text>

      {share && (
        <Flexbox horizontal justify={'flex-end'}>
          <Button danger disabled={busy} size={'small'} type={'text'} onClick={stopSharing}>
            {t('goalDetail.share.stop')}
          </Button>
        </Flexbox>
      )}
    </Flexbox>
  );
});

GoalSharePopover.displayName = 'GoalSharePopover';

export default GoalSharePopover;
