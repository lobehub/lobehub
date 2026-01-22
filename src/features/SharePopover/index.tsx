'use client';

import {
  Button,
  Flexbox,
  Popover,
  Skeleton,
  Text,
  copyToClipboard,
  usePopoverContext,
} from '@lobehub/ui';
import { App, Divider, Select } from 'antd';
import { ExternalLinkIcon, LinkIcon, LockIcon } from 'lucide-react';
import { type ReactNode, memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { useAppOrigin } from '@/hooks/useAppOrigin';
import { useIsMobile } from '@/hooks/useIsMobile';
import { topicService } from '@/services/topic';
import { useChatStore } from '@/store/chat';

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
      // Show confirmation when changing from private to link
      if (currentVisibility === 'private' && visibility === 'link') {
        modal.confirm({
          cancelText: t('cancel', { ns: 'common' }),
          content: t('shareModal.popover.privacyWarning.content'),
          okText: t('shareModal.popover.privacyWarning.confirm'),
          onOk: () => updateVisibility(visibility),
          title: t('shareModal.popover.privacyWarning.title'),
          type: 'warning',
        });
      } else {
        updateVisibility(visibility);
      }
    },
    [currentVisibility, modal, t, updateVisibility],
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
        <Select
          disabled={updating}
          getPopupContainer={() => containerRef.current || document.body}
          labelRender={({ value }) => {
            const option = visibilityOptions.find((o) => o.value === value);
            return (
              <Flexbox align="center" gap={8} horizontal>
                {option?.icon}
                {option?.label}
              </Flexbox>
            );
          }}
          onChange={handleVisibilityChange}
          optionRender={(option) => (
            <Flexbox align="center" gap={8} horizontal>
              {visibilityOptions.find((o) => o.value === option.value)?.icon}
              {option.label}
            </Flexbox>
          )}
          options={visibilityOptions}
          style={{ width: '100%' }}
          value={currentVisibility}
        />
      </Flexbox>

      <Text className={styles.hint} type="secondary">
        {getVisibilityHint()}
      </Text>

      <Divider style={{ margin: '4px 0' }} />

      <Flexbox align="center" horizontal justify="space-between">
        <Button
          icon={ExternalLinkIcon}
          onClick={handleOpenModal}
          size="small"
          type="text"
          variant="text"
        >
          {t('shareModal.popover.moreOptions')}
        </Button>
        <Button icon={LinkIcon} onClick={handleCopyLink} size="small" type="primary">
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
      styles={{
        content: {
          padding: 0,
          width: isMobile ? '100vw' : 366,
        },
      }}
      trigger={['click']}
    >
      {children}
    </Popover>
  );
});

export default SharePopover;
