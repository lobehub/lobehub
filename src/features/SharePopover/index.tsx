'use client';

import {
  Button,
  Checkbox,
  copyToClipboard,
  Flexbox,
  LobeSelect,
  Popover,
  Skeleton,
  Text,
  usePopoverContext,
} from '@lobehub/ui';
import { App, Divider } from 'antd';
import { ExternalLinkIcon, LinkIcon, LockIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { useAppOrigin } from '@/hooks/useAppOrigin';
import { useIsMobile } from '@/hooks/useIsMobile';
import { topicService } from '@/services/topic';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { styles } from './style';

type Visibility = 'private' | 'link';

interface SharePopoverContentProps {
  onOpenModal?: () => void;
}

const SharePopoverContent = memo<SharePopoverContentProps>(({ onOpenModal }) => {
  const { t } = useTranslation('chat');
  const { message, modal } = App.useApp();
  const [updating, setUpdating] = useState(false);
  const { close } = usePopoverContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const appOrigin = useAppOrigin();

  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const [hideTopicSharePrivacyWarning, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.systemStatus(s).hideTopicSharePrivacyWarning ?? false,
    s.updateSystemStatus,
  ]);

  const {
    data: shareInfo,
    isLoading,
    mutate,
  } = useSWR(
    activeTopicId ? ['topic-share-info', activeTopicId] : null,
    () => topicService.getShareInfo(activeTopicId!),
    { revalidateOnFocus: false },
  );

  // Auto-create share record if not exists
  useEffect(() => {
    if (!isLoading && !shareInfo && activeTopicId) {
      topicService.enableSharing(activeTopicId, 'private').then(() => mutate());
    }
  }, [isLoading, shareInfo, activeTopicId, mutate]);

  const shareUrl = shareInfo?.id ? `${appOrigin}/share/t/${shareInfo.id}` : '';
  const currentVisibility = (shareInfo?.visibility as Visibility) || 'private';

  const updateVisibility = useCallback(
    async (visibility: Visibility) => {
      if (!activeTopicId) return;

      setUpdating(true);
      try {
        await topicService.updateShareVisibility(activeTopicId, visibility);
        await mutate();
        message.success(t('shareModal.link.visibilityUpdated'));
      } catch {
        message.error(t('shareModal.link.updateError'));
      } finally {
        setUpdating(false);
      }
    },
    [activeTopicId, mutate, message, t],
  );

  const handleVisibilityChange = useCallback(
    (visibility: Visibility) => {
      // Show confirmation when changing from private to link (unless user has dismissed it)
      if (
        currentVisibility === 'private' &&
        visibility === 'link' &&
        !hideTopicSharePrivacyWarning
      ) {
        let doNotShowAgain = false;

        modal.confirm({
          cancelText: t('cancel', { ns: 'common' }),
          centered: true,
          content: (
            <div>
              <p>{t('shareModal.popover.privacyWarning.content')}</p>
              <div style={{ marginTop: 16 }}>
                <Checkbox
                  onChange={(v) => {
                    doNotShowAgain = v;
                  }}
                >
                  {t('shareModal.popover.privacyWarning.doNotShowAgain')}
                </Checkbox>
              </div>
            </div>
          ),
          okText: t('shareModal.popover.privacyWarning.confirm'),
          onOk: () => {
            if (doNotShowAgain) {
              updateSystemStatus({ hideTopicSharePrivacyWarning: true });
            }
            updateVisibility(visibility);
          },
          title: t('shareModal.popover.privacyWarning.title'),
          type: 'warning',
        });
      } else {
        updateVisibility(visibility);
      }
    },
    [
      currentVisibility,
      hideTopicSharePrivacyWarning,
      modal,
      t,
      updateSystemStatus,
      updateVisibility,
    ],
  );

  const handleCopyLink = useCallback(async () => {
    if (!shareUrl) return;
    await copyToClipboard(shareUrl);
    message.success(t('shareModal.copyLinkSuccess'));
  }, [shareUrl, message, t]);

  const handleOpenModal = useCallback(() => {
    close();
    onOpenModal?.();
  }, [close, onOpenModal]);

  // Loading state
  if (isLoading || !shareInfo) {
    return (
      <Flexbox className={styles.container} gap={16}>
        <Text strong>{t('share', { ns: 'common' })}</Text>
        <Skeleton active paragraph={{ rows: 2 }} />
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
      icon: <LinkIcon size={14} />,
      label: t('shareModal.link.permissionLink'),
      value: 'link',
    },
  ];

  const getVisibilityHint = () => {
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
        <LobeSelect
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
        <Button
          icon={ExternalLinkIcon}
          size="small"
          type="text"
          variant="text"
          onClick={handleOpenModal}
        >
          {t('shareModal.popover.moreOptions')}
        </Button>
        <Button icon={LinkIcon} size="small" type="primary" onClick={handleCopyLink}>
          {t('shareModal.copyLink')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

interface SharePopoverProps {
  children?: ReactNode;
  onOpenModal?: () => void;
}

const SharePopover = memo<SharePopoverProps>(({ children, onOpenModal }) => {
  const isMobile = useIsMobile();

  return (
    <Popover
      arrow={false}
      content={<SharePopoverContent onOpenModal={onOpenModal} />}
      placement={isMobile ? 'top' : 'bottomRight'}
      trigger={['click']}
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
