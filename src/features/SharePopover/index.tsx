'use client';

import { copyToClipboard, Flexbox, Popover, usePopoverContext } from '@lobehub/ui';
import { Button, Checkbox, confirmModal, Select, Text, toast } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
import {
  FileOutputIcon,
  ImageIcon,
  KeyRoundIcon,
  LinkIcon,
  LockIcon,
  PaperclipIcon,
  WrenchIcon,
} from 'lucide-react';
import { type ReactNode } from 'react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { ArticleSkeleton } from '@/components/Skeleton';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { useIsMobile } from '@/hooks/useIsMobile';
import { usePermission } from '@/hooks/usePermission';
import { useTopicSharePermission } from '@/hooks/useTopicSharePermission';
import { shareKeys } from '@/libs/swr/keys';
import { topicService } from '@/services/topic';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { styles } from './style';

type Visibility = 'private' | 'link';

const PRIVACY_WARNING_ITEMS = [
  { icon: WrenchIcon, labelKey: 'shareModal.popover.privacyWarning.items.toolCalls' },
  { icon: KeyRoundIcon, labelKey: 'shareModal.popover.privacyWarning.items.credentials' },
  { icon: ImageIcon, labelKey: 'shareModal.popover.privacyWarning.items.images' },
  { icon: PaperclipIcon, labelKey: 'shareModal.popover.privacyWarning.items.files' },
] as const;

interface SharePopoverContentProps {
  /** Owner of the topic — carries the agent-level topic-share policy. */
  agentId?: string;
  onOpenModal?: () => void;
  topicId?: string;
}

const SharePopoverContent = memo<SharePopoverContentProps>(({ agentId, onOpenModal, topicId }) => {
  const { t } = useTranslation('chat');

  const [updating, setUpdating] = useState(false);
  const { close } = usePopoverContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const appOrigin = useAppOrigin();
  const { allowed: canShare, reason } = usePermission('edit_own_content');
  // Narrower than `canShare`: publishing a link may be reserved to the agent's
  // creator and workspace owners. Export and revoking stay open to everyone who
  // can reach this popover at all.
  const { allowed: canPublishLink, reason: publishRestrictedReason } =
    useTopicSharePermission(agentId);

  const chatActiveTopicId = useChatStore((s) => s.activeTopicId);
  const activeTopicId = topicId ?? chatActiveTopicId;
  const [hideTopicSharePrivacyWarning, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.systemStatus(s).hideTopicSharePrivacyWarning ?? false,
    s.updateSystemStatus,
  ]);

  // Scoped to the topic that failed: the popover is reused across topics, so a
  // sticky boolean would keep showing the error on the next one.
  const [failedTopicId, setFailedTopicId] = useState<string>();
  const {
    data: shareInfo,
    error: loadError,
    isLoading,
    mutate,
  } = useSWR(
    activeTopicId && canShare ? shareKeys.topicInfo(activeTopicId) : null,
    () => topicService.getShareInfo(activeTopicId!),
    { revalidateOnFocus: false },
  );

  // Auto-create share record if not exists. Surface failures (e.g. a 403 from
  // the share permission gate) instead of leaving the popover on the skeleton.
  // Skipped entirely when the caller cannot publish: the placeholder is of no
  // use to them, and under a restricted agent the server would refuse it.
  useEffect(() => {
    if (isLoading || loadError || shareInfo || !activeTopicId || !canShare || !canPublishLink)
      return;
    // One attempt per topic — a rerender must not retry a create we know failed.
    if (failedTopicId === activeTopicId) return;

    topicService
      .enableSharing(activeTopicId, 'private')
      .then(() => mutate())
      .catch(() => setFailedTopicId(activeTopicId));
  }, [
    isLoading,
    loadError,
    shareInfo,
    activeTopicId,
    canShare,
    canPublishLink,
    failedTopicId,
    mutate,
  ]);

  const shareUrl = shareInfo?.id ? `${appOrigin}/share/t/${shareInfo.id}` : '';
  const currentVisibility = (shareInfo?.visibility as Visibility) || 'private';

  const updateVisibility = useCallback(
    async (visibility: Visibility) => {
      if (!activeTopicId) return;

      setUpdating(true);
      try {
        await topicService.updateShareVisibility(activeTopicId, visibility);
        await mutate();
        // Auto-copy the share link the moment link sharing is enabled
        if (visibility === 'link' && shareUrl) {
          await copyToClipboard(shareUrl);
          toast.success(t('shareModal.copyLinkSuccess'));
        } else {
          toast.success(t('shareModal.link.visibilityUpdated'));
        }
      } catch {
        toast.error(t('shareModal.link.updateError'));
      } finally {
        setUpdating(false);
      }
    },
    [activeTopicId, mutate, t, shareUrl],
  );

  const handleVisibilityChange = useCallback(
    (visibility: Visibility) => {
      // The `link` option is already disabled in that case; this is the guard
      // that keeps a keyboard selection from racing past it.
      if (visibility === 'link' && !canPublishLink) return;

      // Show confirmation when changing from private to link (unless user has dismissed it)
      if (
        currentVisibility === 'private' &&
        visibility === 'link' &&
        !hideTopicSharePrivacyWarning
      ) {
        let doNotShowAgain = false;

        confirmModal({
          cancelText: t('cancel', { ns: 'common' }),
          content: (
            <Flexbox gap={16}>
              <Text>{t('shareModal.popover.privacyWarning.content')}</Text>
              <Flexbox gap={12} paddingBlock={8}>
                {PRIVACY_WARNING_ITEMS.map(({ icon: ItemIcon, labelKey }) => (
                  <Flexbox horizontal align="center" gap={8} key={labelKey}>
                    <ItemIcon size={16} />
                    <Text>{t(labelKey)}</Text>
                  </Flexbox>
                ))}
              </Flexbox>
              <Text>{t('shareModal.popover.privacyWarning.note')}</Text>
              <Checkbox
                onChange={(v) => {
                  doNotShowAgain = v;
                }}
              >
                {t('shareModal.popover.privacyWarning.doNotShowAgain')}
              </Checkbox>
            </Flexbox>
          ),
          okText: t('shareModal.popover.privacyWarning.confirm'),
          onOk: () => {
            if (doNotShowAgain) {
              updateSystemStatus({ hideTopicSharePrivacyWarning: true });
            }
            updateVisibility(visibility);
          },
          title: t('shareModal.popover.privacyWarning.title'),
        });
      } else {
        updateVisibility(visibility);
      }
    },
    [
      canPublishLink,
      currentVisibility,
      hideTopicSharePrivacyWarning,
      t,
      updateSystemStatus,
      updateVisibility,
    ],
  );

  const handleCopyLink = useCallback(async () => {
    if (!shareUrl) return;
    await copyToClipboard(shareUrl);
    toast.success(t('shareModal.copyLinkSuccess'));
  }, [shareUrl, t]);

  const handleOpenModal = useCallback(() => {
    close();
    onOpenModal?.();
  }, [close, onOpenModal]);

  // Clearing the per-topic failure re-arms the create effect; `mutate` reruns
  // the read so a transient load error clears with it.
  const handleRetry = useCallback(() => {
    setFailedTopicId(undefined);
    void mutate();
  }, [mutate]);

  if (!canShare) {
    return (
      <Flexbox className={styles.container} gap={8}>
        <Text strong>{t('share', { ns: 'common' })}</Text>
        <Text type="secondary">{reason}</Text>
      </Flexbox>
    );
  }

  if (loadError || failedTopicId === activeTopicId) {
    return (
      <Flexbox className={styles.container} gap={8}>
        <Text strong>{t('share', { ns: 'common' })}</Text>
        <Text type="secondary">{t('shareModal.popover.loadError')}</Text>
        <Flexbox horizontal justify={'flex-end'}>
          <Button size="small" type="text" onClick={handleRetry}>
            {t('retry', { ns: 'common' })}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  }

  // Loading state. Without a share record a restricted caller still gets the
  // real body (visibility defaults to private) instead of an eternal skeleton.
  if (isLoading || (!shareInfo && canPublishLink)) {
    return (
      <Flexbox className={styles.container} gap={16}>
        <Text strong>{t('share', { ns: 'common' })}</Text>
        <ArticleSkeleton rows={2} />
      </Flexbox>
    );
  }

  const visibilityOptions = [
    {
      icon: <LockIcon size={14} />,
      label: t('shareModal.link.permissionPrivate'),
      value: 'private',
    },
    {
      disabled: !canPublishLink,
      icon: <LinkIcon size={14} />,
      label: t('shareModal.link.permissionLink'),
      value: 'link',
    },
  ];

  const getVisibilityHint = () => {
    // Why the link option is greyed out matters more than restating what
    // "private" means — a member who can't publish needs to know who to ask.
    if (!canPublishLink && currentVisibility === 'private') return publishRestrictedReason;

    switch (currentVisibility) {
      case 'private': {
        return t('shareModal.link.privateHint');
      }
      case 'link': {
        return t('shareModal.link.linkHint');
      }
    }
  };

  return (
    <Flexbox className={styles.container} gap={12} ref={containerRef}>
      <Text strong>{t('shareModal.popover.title')}</Text>

      <Flexbox gap={4}>
        <Text type="secondary">{t('shareModal.popover.visibility')}</Text>
        <Select
          disabled={updating}
          options={visibilityOptions}
          style={{ width: '100%' }}
          value={currentVisibility}
          labelRender={({ value }) => {
            const option = visibilityOptions.find((o) => o.value === value);
            return (
              <Flexbox horizontal align="center" gap={8}>
                {option?.icon}
                {option?.label}
              </Flexbox>
            );
          }}
          optionRender={(option) => (
            <Flexbox horizontal align="center" gap={8}>
              {visibilityOptions.find((o) => o.value === option.value)?.icon}
              {option.label}
            </Flexbox>
          )}
          onChange={handleVisibilityChange}
        />
      </Flexbox>

      <Text className={styles.hint} type="secondary">
        {getVisibilityHint()}
      </Text>

      <Divider style={{ margin: '4px 0' }} />

      <Flexbox horizontal align="center" justify="space-between">
        <Button icon={FileOutputIcon} size="small" type="text" onClick={handleOpenModal}>
          {t('shareModal.popover.export')}
        </Button>
        {currentVisibility !== 'private' && (
          <Button icon={LinkIcon} size="small" type="primary" onClick={handleCopyLink}>
            {t('shareModal.copyLink')}
          </Button>
        )}
      </Flexbox>
    </Flexbox>
  );
});

interface SharePopoverProps {
  /** Owner of the topic — carries the agent-level topic-share policy. */
  agentId?: string;
  children?: ReactNode;
  onOpenModal?: () => void;
  topicId?: string;
}

const SharePopover = memo<SharePopoverProps>(({ agentId, children, onOpenModal, topicId }) => {
  const isMobile = useIsMobile();

  return (
    <Popover
      arrow={false}
      placement={isMobile ? 'top' : 'bottomRight'}
      trigger={['click']}
      content={
        <SharePopoverContent agentId={agentId} topicId={topicId} onOpenModal={onOpenModal} />
      }
      styles={{
        content: {
          padding: 0,
          width: isMobile ? '100vw' : 366,
        },
      }}
    >
      {children}
    </Popover>
  );
});

export default SharePopover;
