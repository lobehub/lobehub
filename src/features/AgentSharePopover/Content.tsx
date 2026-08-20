'use client';

import { copyToClipboard, Flexbox, Skeleton, Text } from '@lobehub/ui';
import { Button, Checkbox, confirmModal, Select, toast } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
import {
  DatabaseIcon,
  LinkIcon,
  LockIcon,
  PaperclipIcon,
  Settings2Icon,
  WrenchIcon,
} from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AgentSharePrivacyNoticeExtension from '@/business/client/features/AgentSharePrivacyNoticeExtension';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { usePermission } from '@/hooks/usePermission';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { createAgentShareSettingsModal } from './SettingsModal';
import { styles } from './style';
import { type AgentShareVisibility, useAgentShare } from './useAgentShare';
import { commitAgentShareVisibility, copyAgentShareLink } from './visibilityUpdate';

const PRIVACY_WARNING_ITEMS = [
  { icon: WrenchIcon, labelKey: 'share.privacyWarning.items.tools' },
  { icon: DatabaseIcon, labelKey: 'share.privacyWarning.items.memory' },
  { icon: PaperclipIcon, labelKey: 'share.privacyWarning.items.files' },
] as const;

interface AgentSharePopoverContentProps {
  agentId?: string;
}

const AgentSharePopoverContent = memo<AgentSharePopoverContentProps>(({ agentId }) => {
  const { t } = useTranslation('agent');

  const [updating, setUpdating] = useState(false);
  const appOrigin = useAppOrigin();
  const { allowed: canShare, reason } = usePermission('edit_own_content');

  const [hideAgentSharePrivacyWarning, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.systemStatus(s).hideAgentSharePrivacyWarning ?? false,
    s.updateSystemStatus,
  ]);

  const { createError, isCreating, isLoading, retryCreate, shareInfo, updateVisibility } =
    useAgentShare(agentId, canShare);

  const shareUrl = shareInfo?.id ? `${appOrigin}/share/a/${shareInfo.id}` : '';
  const currentVisibility = (shareInfo?.visibility as AgentShareVisibility) || 'private';

  const applyVisibility = useCallback(
    async (visibility: AgentShareVisibility) => {
      setUpdating(true);
      try {
        const result = await commitAgentShareVisibility({
          copyLink: () => copyToClipboard(shareUrl),
          shouldCopyLink: visibility === 'link' && Boolean(shareUrl),
          updateVisibility: () => updateVisibility(visibility),
        });

        if (result === 'copied') {
          toast.success(t('share.copyLinkSuccess'));
        } else {
          toast.success(t('share.visibilityUpdated'));
          if (result === 'updated-copy-failed') toast.error(t('copyFail', { ns: 'common' }));
        }
      } catch {
        toast.error(t('share.updateError'));
      } finally {
        setUpdating(false);
      }
    },
    [updateVisibility, shareUrl, t],
  );

  const handleVisibilityChange = useCallback(
    (visibility: AgentShareVisibility) => {
      // Show confirmation when changing from private to link (unless dismissed)
      if (
        currentVisibility === 'private' &&
        visibility === 'link' &&
        !hideAgentSharePrivacyWarning
      ) {
        let doNotShowAgain = false;

        confirmModal({
          cancelText: t('cancel', { ns: 'common' }),
          content: (
            <Flexbox gap={16}>
              <Text>{t('share.privacyWarning.content')}</Text>
              <Flexbox gap={12} paddingBlock={8}>
                {PRIVACY_WARNING_ITEMS.map(({ icon: ItemIcon, labelKey }) => (
                  <Flexbox horizontal align="center" gap={8} key={labelKey}>
                    <ItemIcon size={16} style={{ flexShrink: 0 }} />
                    <Text>{t(labelKey)}</Text>
                  </Flexbox>
                ))}
                <AgentSharePrivacyNoticeExtension />
              </Flexbox>
              <Text>{t('share.privacyWarning.note')}</Text>
              <Checkbox
                onChange={(v) => {
                  doNotShowAgain = v;
                }}
              >
                {t('share.privacyWarning.doNotShowAgain')}
              </Checkbox>
            </Flexbox>
          ),
          okText: t('share.privacyWarning.confirm'),
          onOk: () => {
            if (doNotShowAgain) {
              updateSystemStatus({ hideAgentSharePrivacyWarning: true });
            }
            applyVisibility(visibility);
          },
          title: t('share.privacyWarning.title'),
        });
      } else {
        applyVisibility(visibility);
      }
    },
    [currentVisibility, hideAgentSharePrivacyWarning, t, updateSystemStatus, applyVisibility],
  );

  const handleCopyLink = useCallback(async () => {
    if (!shareUrl) return;
    const copied = await copyAgentShareLink(() => copyToClipboard(shareUrl));
    if (copied) toast.success(t('share.copyLinkSuccess'));
    else toast.error(t('copyFail', { ns: 'common' }));
  }, [shareUrl, t]);

  const handleOpenSettings = useCallback(() => {
    if (!agentId) return;
    createAgentShareSettingsModal(agentId);
  }, [agentId]);

  if (!canShare) {
    return (
      <Flexbox className={styles.container} gap={8}>
        <Text strong>{t('share.popover.title')}</Text>
        <Text type="secondary">{reason}</Text>
      </Flexbox>
    );
  }

  if (createError) {
    return (
      <Flexbox className={styles.container} gap={12}>
        <Text strong>{t('share.popover.title')}</Text>
        <Text type="danger">{t('share.createError')}</Text>
        <Button loading={isCreating} size="small" onClick={retryCreate}>
          {t('retry', { ns: 'common' })}
        </Button>
      </Flexbox>
    );
  }

  if (isLoading || !shareInfo) {
    return (
      <Flexbox className={styles.container} gap={16}>
        <Text strong>{t('share.popover.title')}</Text>
        <Skeleton active paragraph={{ rows: 2 }} />
      </Flexbox>
    );
  }

  const visibilityOptions = [
    {
      icon: <LockIcon size={14} />,
      label: t('share.visibility.private'),
      value: 'private',
    },
    {
      icon: <LinkIcon size={14} />,
      label: t('share.visibility.link'),
      value: 'link',
    },
  ];

  const visibilityHint =
    currentVisibility === 'private'
      ? t('share.visibility.privateHint')
      : t('share.visibility.linkHint');

  return (
    <Flexbox className={styles.container} gap={12}>
      <Text strong>{t('share.popover.title')}</Text>

      <Flexbox gap={4}>
        <Text type="secondary">{t('share.popover.visibility')}</Text>
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
        {visibilityHint}
      </Text>

      <Divider style={{ margin: '4px 0' }} />

      <Flexbox horizontal align="center" justify="space-between">
        <Button icon={Settings2Icon} size="small" type="text" onClick={handleOpenSettings}>
          {t('share.settingsEntry')}
        </Button>
        {currentVisibility !== 'private' && (
          <Button icon={LinkIcon} size="small" type="primary" onClick={handleCopyLink}>
            {t('share.copyLink')}
          </Button>
        )}
      </Flexbox>
    </Flexbox>
  );
});

AgentSharePopoverContent.displayName = 'AgentSharePopoverContent';

export default AgentSharePopoverContent;
