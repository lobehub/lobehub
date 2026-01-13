'use client';

import { Button, Flexbox, Input, Popover, copyToClipboard, usePopoverContext } from '@lobehub/ui';
import { App, Divider, Select, Skeleton, Typography } from 'antd';
import { CopyIcon, ExternalLinkIcon, GlobeIcon, LinkIcon, LockIcon, UserIcon } from 'lucide-react';
import { type ReactNode, memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { useIsMobile } from '@/hooks/useIsMobile';
import { topicService } from '@/services/topic';
import { useChatStore } from '@/store/chat';

import { useStyles } from './style';

type Permission = 'private' | 'public' | 'public_signin';

interface SharePopoverContentProps {
  onOpenModal?: () => void;
}

const SharePopoverContent = memo<SharePopoverContentProps>(({ onOpenModal }) => {
  const { t } = useTranslation('chat');
  const { message, modal } = App.useApp();
  const { styles } = useStyles();
  const [updating, setUpdating] = useState(false);
  const { close } = usePopoverContext();
  const containerRef = useRef<HTMLDivElement>(null);

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

  const shareUrl = shareInfo?.id ? `${window.location.origin}/share/t/${shareInfo.id}` : '';
  const currentPermission = (shareInfo?.accessPermission as Permission) || 'private';

  const updatePermission = useCallback(
    async (permission: Permission) => {
      if (!activeTopicId) return;

      setUpdating(true);
      try {
        await topicService.updateSharePermission(activeTopicId, permission);
        await mutate();
        message.success(t('shareModal.link.permissionUpdated'));
      } catch {
        message.error(t('shareModal.link.updateError'));
      } finally {
        setUpdating(false);
      }
    },
    [activeTopicId, mutate, message, t],
  );

  const handlePermissionChange = useCallback(
    (permission: Permission) => {
      // Show confirmation when changing from private to any other permission
      if (currentPermission === 'private' && permission !== 'private') {
        modal.confirm({
          cancelText: t('cancel', { ns: 'common' }),
          content: t('shareModal.popover.privacyWarning.content'),
          okText: t('shareModal.popover.privacyWarning.confirm'),
          onOk: () => updatePermission(permission),
          title: t('shareModal.popover.privacyWarning.title'),
          type: 'warning',
        });
      } else {
        updatePermission(permission);
      }
    },
    [currentPermission, modal, t, updatePermission],
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
        <Typography.Text strong>{t('share', { ns: 'common' })}</Typography.Text>
        <Skeleton active paragraph={{ rows: 2 }} />
      </Flexbox>
    );
  }

  const permissionOptions = [
    {
      icon: <LockIcon size={14} />,
      label: t('shareModal.link.permissionPrivate'),
      value: 'private',
    },
    {
      icon: <UserIcon size={14} />,
      label: t('shareModal.link.permissionPublicSignin'),
      value: 'public_signin',
    },
    {
      icon: <GlobeIcon size={14} />,
      label: t('shareModal.link.permissionPublic'),
      value: 'public',
    },
  ];

  const getPermissionHint = () => {
    switch (currentPermission) {
      case 'private': {
        return t('shareModal.link.privateHint');
      }
      case 'public': {
        return t('shareModal.link.publicHint');
      }
      case 'public_signin': {
        return t('shareModal.link.publicSigninHint');
      }
    }
  };

  return (
    <Flexbox className={styles.container} gap={12} ref={containerRef}>
      <Typography.Text strong>{t('share', { ns: 'common' })}</Typography.Text>

      <Flexbox align="center" gap={8} horizontal>
        <Input prefix={<LinkIcon size={16} />} readOnly style={{ flex: 1 }} value={shareUrl} />
        <Select
          disabled={updating}
          getPopupContainer={() => containerRef.current || document.body}
          onChange={handlePermissionChange}
          optionRender={(option) => (
            <Flexbox align="center" gap={8} horizontal>
              {permissionOptions.find((o) => o.value === option.value)?.icon}
              {option.label}
            </Flexbox>
          )}
          options={permissionOptions}
          style={{ width: 120 }}
          value={currentPermission}
        />
      </Flexbox>

      <Typography.Text className={styles.hint} type="secondary">
        {getPermissionHint()}
      </Typography.Text>

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
        <Button icon={CopyIcon} onClick={handleCopyLink} size="small" type="primary">
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
          width: isMobile ? '100vw' : 420,
        },
      }}
      trigger={['click']}
    >
      {children}
    </Popover>
  );
});

export default SharePopover;
