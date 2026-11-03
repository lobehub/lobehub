'use client';

import {
  Button,
  Center,
  Checkbox,
  confirmModal,
  copyToClipboard,
  cx,
  Flexbox,
  Icon,
  Input,
  Popover,
  Switch,
  Text,
  toast,
  usePopoverContext,
} from '@lobehub/ui';
import {
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  GlobeIcon,
  ImageIcon,
  KeyRoundIcon,
  LockIcon,
  PaperclipIcon,
  WrenchIcon,
} from 'lucide-react';
import { type ReactNode } from 'react';
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ArticleSkeleton } from '@/components/Skeleton';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { useIsMobile } from '@/hooks/useIsMobile';
import { usePermission } from '@/hooks/usePermission';
import { useTopicSharePermission } from '@/hooks/useTopicSharePermission';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { styles } from './style';
import { type ShareVisibility as Visibility, useTopicShare } from './useTopicShare';

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

  const {
    error: loadError,
    isLoading,
    retry,
    setVisibility,
    shareInfo,
    visibility: currentVisibility,
  } = useTopicShare(activeTopicId, canShare);

  const shareUrl = shareInfo?.id ? `${appOrigin}/share/t/${shareInfo.id}` : '';

  const updateVisibility = useCallback(
    async (visibility: Visibility) => {
      if (!activeTopicId) return;

      setUpdating(true);
      try {
        const shareId = await setVisibility(visibility);
        // Auto-copy the share link the moment link sharing is enabled
        if (visibility === 'link' && shareId) {
          await copyToClipboard(`${appOrigin}/share/t/${shareId}`);
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
    [activeTopicId, appOrigin, setVisibility, t],
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

  const handleRetry = useCallback(() => {
    void retry();
  }, [retry]);

  if (!canShare) {
    return (
      <Flexbox className={styles.container} gap={8}>
        <Text strong>{t('share', { ns: 'common' })}</Text>
        <Text type="secondary">{reason}</Text>
      </Flexbox>
    );
  }

  if (loadError) {
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

  // Without a share record the body still renders: visibility defaults to private.
  if (isLoading) {
    return (
      <Flexbox className={styles.container} gap={16}>
        <Text strong>{t('share', { ns: 'common' })}</Text>
        <ArticleSkeleton rows={2} />
      </Flexbox>
    );
  }

  const isLinkShared = currentVisibility === 'link';
  const linkRestricted = !canPublishLink && !isLinkShared;

  return (
    <Flexbox className={styles.panel} ref={containerRef}>
      <Flexbox className={styles.section} gap={10}>
        <Flexbox horizontal align={'center'} gap={10}>
          <Center className={cx(styles.badge, isLinkShared && styles.badgeActive)} flex={'none'}>
            <Icon icon={isLinkShared ? GlobeIcon : LockIcon} size={16} />
          </Center>
          <Flexbox flex={1} gap={1} style={{ minWidth: 0 }}>
            <Text strong type={linkRestricted ? 'secondary' : undefined}>
              {t('shareModal.popover.linkShare')}
            </Text>
            <Text fontSize={12} type={'secondary'}>
              {isLinkShared ? t('shareModal.popover.linkOn') : t('shareModal.popover.linkOff')}
            </Text>
          </Flexbox>
          <Switch
            aria-label={t('shareModal.popover.linkShare')}
            checked={isLinkShared}
            disabled={updating || linkRestricted}
            loading={updating}
            onChange={(checked) => handleVisibilityChange(checked ? 'link' : 'private')}
          />
        </Flexbox>

        {linkRestricted && <div className={styles.notice}>{publishRestrictedReason}</div>}

        {isLinkShared && shareUrl && (
          <Flexbox horizontal gap={6}>
            <Input
              readOnly
              aria-label={t('shareModal.link')}
              className={styles.url}
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button icon={CopyIcon} type={'primary'} onClick={handleCopyLink}>
              {t('copy', { ns: 'common' })}
            </Button>
          </Flexbox>
        )}
      </Flexbox>

      <div className={styles.divider} />

      <button className={styles.exportRow} type={'button'} onClick={handleOpenModal}>
        <Icon className={styles.exportIcon} icon={DownloadIcon} size={16} />
        <span className={styles.exportLabel}>{t('shareModal.popover.export')}</span>
        <span className={styles.exportHint}>{t('shareModal.popover.exportFormats')}</span>
        <Icon className={styles.exportIcon} icon={ChevronRightIcon} size={14} />
      </button>
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
