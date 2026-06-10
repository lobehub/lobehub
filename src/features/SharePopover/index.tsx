'use client';

import {
  Button,
  Checkbox,
  copyToClipboard,
  Flexbox,
  Popover,
  Skeleton,
  Text,
  usePopoverContext,
} from '@lobehub/ui';
import { confirmModal, Select } from '@lobehub/ui/base-ui';
import { App, Divider } from 'antd';
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

import { useAppOrigin } from '@/hooks/useAppOrigin';
import { useIsMobile } from '@/hooks/useIsMobile';
import { usePermission } from '@/hooks/usePermission';
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
  onOpenModal?: () => void;
  topicId?: string;
}

const SharePopoverContent = memo<SharePopoverContentProps>(({ onOpenModal, topicId }) => {
  const { t } = useTranslation('chat');
  const { message } = App.useApp();
  const [updating, setUpdating] = useState(false);
  const { close } = usePopoverContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const appOrigin = useAppOrigin();
  const { allowed: canShare, reason } = usePermission('edit_own_content');

  const chatActiveTopicId = useChatStore((s) => s.activeTopicId);
  const activeTopicId = topicId ?? chatActiveTopicId;
  const [hideTopicSharePrivacyWarning, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.systemStatus(s).hideTopicSharePrivacyWarning ?? false,
    s.updateSystemStatus,
  ]);

  const {
    data: shareInfo,
    isLoading,
    mutate,
  } = useSWR(
    activeTopicId && canShare ? ['topic-share-info', activeTopicId] : null,
    () => topicService.getShareInfo(activeTopicId!),
    { revalidateOnFocus: false },
  );

  // Auto-create share record if not exists
  useEffect(() => {
    if (!isLoading && !shareInfo && activeTopicId && canShare) {
      topicService.enableSharing(activeTopicId, 'private').then(() => mutate());
    }
  }, [isLoading, shareInfo, activeTopicId, canShare, mutate]);

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
          message.success(t('shareModal.copyLinkSuccess'));
        } else {
          message.success(t('shareModal.link.visibilityUpdated'));
        }
      } catch {
        message.error(t('shareModal.link.updateError'));
      } finally {
        setUpdating(false);
      }
    },
    [activeTopicId, mutate, message, t, shareUrl],
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
    [currentVisibility, hideTopicSharePrivacyWarning, t, updateSystemStatus, updateVisibility],
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

  if (!canShare) {
    return (
      <Flexbox className={styles.container} gap={8}>
        <Text strong>{t('share', { ns: 'common' })}</Text>
        <Text type="secondary">{reason}</Text>
      </Flexbox>
    );
  }

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
          icon={FileOutputIcon}
          size="small"
          type="text"
          variant="text"
          onClick={handleOpenModal}
        >
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
  children?: ReactNode;
  onOpenModal?: () => void;
  topicId?: string;
}

const SharePopover = memo<SharePopoverProps>(({ children, onOpenModal, topicId }) => {
  const isMobile = useIsMobile();

  return (
    <Popover
      arrow={false}
      content={<SharePopoverContent topicId={topicId} onOpenModal={onOpenModal} />}
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
