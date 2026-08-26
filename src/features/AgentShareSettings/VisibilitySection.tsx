'use client';

import { copyToClipboard, Flexbox, Skeleton, Text } from '@lobehub/ui';
import { Button, Checkbox, confirmModal, Select, toast } from '@lobehub/ui/base-ui';
import { DatabaseIcon, LinkIcon, LockIcon, PaperclipIcon, WrenchIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AgentSharePrivacyNoticeExtension from '@/business/client/features/AgentSharePrivacyNoticeExtension';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { Section } from './SectionLayout';
import { type AgentShareVisibility, useAgentShare } from './useAgentShare';
import { commitAgentShareVisibility, copyAgentShareLink } from './visibilityUpdate';

const PRIVACY_WARNING_ITEMS = [
  { icon: WrenchIcon, labelKey: 'share.privacyWarning.items.tools' },
  { icon: DatabaseIcon, labelKey: 'share.privacyWarning.items.memory' },
  { icon: PaperclipIcon, labelKey: 'share.privacyWarning.items.files' },
] as const;

interface VisibilitySectionProps {
  agentId: string;
}

/**
 * Visibility control of the share settings page: private / link switch with the
 * privacy-warning confirmation, plus the copy-link action once a link exists.
 */
const VisibilitySection = memo<VisibilitySectionProps>(({ agentId }) => {
  const { t } = useTranslation('agent');

  const [updating, setUpdating] = useState(false);
  const appOrigin = useAppOrigin();

  const [hideAgentSharePrivacyWarning, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.systemStatus(s).hideAgentSharePrivacyWarning ?? false,
    s.updateSystemStatus,
  ]);

  const { createError, isCreating, isLoading, retryCreate, shareInfo, updateVisibility } =
    useAgentShare(agentId, true);

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

  if (createError) {
    return (
      <Section title={t('share.visibility.title')}>
        <Flexbox align="flex-start" gap={12}>
          <Text type="danger">{t('share.createError')}</Text>
          <Button loading={isCreating} size="small" onClick={retryCreate}>
            {t('retry', { ns: 'common' })}
          </Button>
        </Flexbox>
      </Section>
    );
  }

  if (isLoading || !shareInfo) {
    return (
      <Section title={t('share.visibility.title')}>
        <Skeleton active paragraph={{ rows: 2 }} />
      </Section>
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
    <Section desc={visibilityHint} title={t('share.visibility.title')}>
      <Flexbox horizontal align="center" gap={8}>
        <Select
          disabled={updating}
          options={visibilityOptions}
          style={{ width: 240 }}
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
        {currentVisibility !== 'private' && (
          <Button icon={LinkIcon} size="small" type="primary" onClick={handleCopyLink}>
            {t('share.copyLink')}
          </Button>
        )}
      </Flexbox>
    </Section>
  );
});

VisibilitySection.displayName = 'AgentShareVisibilitySection';

export default VisibilitySection;
