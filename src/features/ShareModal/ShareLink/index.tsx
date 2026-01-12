import { Button, Flexbox, copyToClipboard } from '@lobehub/ui';
import { App, Input, Select, Skeleton, Typography } from 'antd';
import { CopyIcon, LinkIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { topicService } from '@/services/topic';
import { useChatStore } from '@/store/chat';

import { styles } from '../style';

type Permission = 'private' | 'public' | 'public_signin';

const ShareLink = memo(() => {
  const { t } = useTranslation('chat');
  const { message } = App.useApp();
  const [updating, setUpdating] = useState(false);

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

  const handlePermissionChange = useCallback(
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

  const handleCopyLink = useCallback(async () => {
    if (!shareUrl) return;
    await copyToClipboard(shareUrl);
    message.success(t('shareModal.copyLinkSuccess'));
  }, [shareUrl, message, t]);

  // No topic selected
  if (!activeTopicId) {
    return (
      <Flexbox align="center" className={styles.body} justify="center" style={{ height: '100%' }}>
        <Typography.Text type="secondary">{t('shareModal.link.noTopic')}</Typography.Text>
      </Flexbox>
    );
  }

  // Loading state
  if (isLoading || !shareInfo) {
    return (
      <Flexbox className={styles.body} gap={16}>
        <Skeleton active paragraph={{ rows: 2 }} />
      </Flexbox>
    );
  }

  const permissionOptions = [
    { label: t('shareModal.link.permissionPrivate'), value: 'private' },
    { label: t('shareModal.link.permissionPublic'), value: 'public' },
    { label: t('shareModal.link.permissionPublicSignin'), value: 'public_signin' },
  ];

  return (
    <Flexbox className={styles.body} gap={16}>
      <Flexbox gap={8} horizontal>
        <Input
          prefix={<LinkIcon size={16} />}
          readOnly
          style={{ flex: 1 }}
          value={shareUrl}
        />
        <Select
          disabled={updating}
          onChange={handlePermissionChange}
          options={permissionOptions}
          style={{ width: 140 }}
          value={currentPermission}
        />
        <Button icon={CopyIcon} onClick={handleCopyLink} type="primary">
          {t('shareModal.copyLink')}
        </Button>
      </Flexbox>
      <Typography.Text type="secondary">
        {currentPermission === 'private' && t('shareModal.link.privateHint')}
        {currentPermission === 'public' && t('shareModal.link.publicHint')}
        {currentPermission === 'public_signin' && t('shareModal.link.publicSigninHint')}
      </Typography.Text>
    </Flexbox>
  );
});

export default ShareLink;
