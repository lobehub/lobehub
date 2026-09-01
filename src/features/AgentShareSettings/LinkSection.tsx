'use client';

import { copyToClipboard, Flexbox, Input, Tooltip } from '@lobehub/ui';
import { Button, confirmModal, Switch, Text, toast } from '@lobehub/ui/base-ui';
import { CopyIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppOrigin } from '@/hooks/useAppOrigin';

import { Section } from './SectionLayout';
import {
  type AgentShareSlugError,
  buildAgentShareUrl,
  normalizeAgentShareSlug,
  validateAgentShareSlug,
} from './shareLink';
import type { AgentShareInfo } from './useAgentShare';
import { resolveLinkToggleState } from './useAgentShareSupported';

const SLUG_ERROR_KEY = {
  invalid: 'share.settings.link.slugError.invalid',
  reserved: 'share.settings.link.slugError.reserved',
  tooLong: 'share.settings.link.slugError.tooLong',
  tooShort: 'share.settings.link.slugError.tooShort',
} as const satisfies Record<AgentShareSlugError, string>;

interface LinkSectionProps {
  onDisable: () => Promise<void>;
  onEnable: () => Promise<void>;
  onUpdateSlug: (slug: string | null) => Promise<void>;
  /** Whether a new share may be published — see `useAgentShareSupported`. */
  publishable: boolean;
  share: AgentShareInfo | undefined;
}

/**
 * Sharing on/off, the visitor link, and the custom slug.
 *
 * Turning sharing off only PAUSES it: the share row keeps its id and custom
 * slug, so visitors are locked out while it is off and turning it back on
 * republishes the very same url — see `AgentShareModel.updateVisibility`.
 */
const LinkSection = memo<LinkSectionProps>((props) => {
  const { onDisable, onEnable, onUpdateSlug, publishable, share } = props;
  const { t } = useTranslation('agent');
  const appOrigin = useAppOrigin();

  const isShared = share?.visibility === 'link';
  const savedSlug = share?.shareConfig?.slug ?? '';
  const {
    canPublish,
    disabled: toggleDisabled,
    offHintKey,
  } = resolveLinkToggleState({
    isShared,
    publishable,
  });

  const [toggling, setToggling] = useState(false);
  const [slugDraft, setSlugDraft] = useState(savedSlug);
  const [slugError, setSlugError] = useState<string>('');
  const [savingSlug, setSavingSlug] = useState(false);

  // Re-sync the draft whenever the server value changes — a save elsewhere, or
  // the row reloading after an enable/disable (which keeps the saved slug).
  useEffect(() => {
    setSlugDraft(savedSlug);
    setSlugError('');
  }, [savedSlug, share?.id]);

  const shareUrl =
    share && isShared
      ? buildAgentShareUrl({ origin: appOrigin, shareId: share.id, slug: savedSlug || undefined })
      : '';

  const handleCopy = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await copyToClipboard(shareUrl);
      toast.success(t('share.settings.link.copied'));
    } catch {
      toast.error(t('copyFail', { ns: 'common' }));
    }
  }, [shareUrl, t]);

  const handleToggle = useCallback(
    async (checked: boolean) => {
      // Publishing is gated (rollout flag / plan); turning an existing share
      // OFF must always stay available, so only the `on` direction is blocked.
      if (checked && !canPublish) return;

      const apply = async () => {
        setToggling(true);
        try {
          await (checked ? onEnable() : onDisable());
        } catch {
          toast.error(t('share.settings.updateError'));
        } finally {
          setToggling(false);
        }
      };

      if (checked) {
        void apply();
        return;
      }

      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('share.settings.link.disableConfirmContent'),
        okText: t('share.settings.link.disableConfirmOk'),
        onOk: apply,
        title: t('share.settings.link.disableConfirmTitle'),
      });
    },
    [canPublish, onDisable, onEnable, t],
  );

  const handleSaveSlug = useCallback(async () => {
    const next = normalizeAgentShareSlug(slugDraft);
    if (next === savedSlug) {
      setSlugDraft(next);
      setSlugError('');
      return;
    }

    if (next) {
      const error = validateAgentShareSlug(next);
      if (error) {
        setSlugError(t(SLUG_ERROR_KEY[error]));
        return;
      }
    }

    setSavingSlug(true);
    setSlugError('');
    try {
      // An emptied field clears the custom slug — the share then resolves by
      // its raw id again.
      await onUpdateSlug(next || null);
      toast.success(t('share.settings.link.slugSaved'));
    } catch (error: any) {
      setSlugError(
        error?.data?.code === 'CONFLICT'
          ? t('share.settings.link.slugError.taken')
          : t('share.settings.updateError'),
      );
    } finally {
      setSavingSlug(false);
    }
  }, [onUpdateSlug, savedSlug, slugDraft, t]);

  const slugDirty = normalizeAgentShareSlug(slugDraft) !== savedSlug;

  return (
    <Section
      desc={t('share.settings.link.desc')}
      title={t('share.settings.link.title')}
      extra={
        <Tooltip title={toggleDisabled ? t('share.settings.link.publishDisabled') : undefined}>
          {/* A disabled control fires no pointer events, so the wrapper carries the hover. */}
          <Flexbox>
            <Switch
              checked={isShared}
              disabled={toggleDisabled}
              loading={toggling}
              onChange={handleToggle}
            />
          </Flexbox>
        </Tooltip>
      }
    >
      {isShared ? (
        <Flexbox gap={12}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Input readOnly style={{ flex: 1 }} value={shareUrl} variant={'filled'} />
            <Button icon={CopyIcon} type={'primary'} onClick={handleCopy}>
              {t('share.settings.link.copy')}
            </Button>
          </Flexbox>

          <Flexbox gap={4}>
            <Text fontSize={12} type={'secondary'}>
              {t('share.settings.link.slugLabel')}
            </Text>
            <Flexbox horizontal align={'center'} gap={8}>
              <Input
                disabled={savingSlug}
                placeholder={t('share.settings.link.slugPlaceholder')}
                prefix={`${appOrigin}/agent/`}
                status={slugError ? 'error' : undefined}
                style={{ flex: 1 }}
                value={slugDraft}
                variant={'filled'}
                onPressEnter={handleSaveSlug}
                onChange={(e) => {
                  setSlugDraft(e.target.value);
                  setSlugError('');
                }}
              />
              <Button disabled={!slugDirty} loading={savingSlug} onClick={handleSaveSlug}>
                {t('save', { ns: 'common' })}
              </Button>
            </Flexbox>
            <Text fontSize={12} type={slugError ? 'danger' : 'secondary'}>
              {slugError || t('share.settings.link.slugHint')}
            </Text>
          </Flexbox>

          <Text fontSize={12} type={'secondary'}>
            {t('share.settings.link.viewCount', { views: String(share?.userViewCount ?? 0) })}
          </Text>
        </Flexbox>
      ) : (
        <Text fontSize={12} type={'secondary'}>
          {t(offHintKey)}
        </Text>
      )}
    </Section>
  );
});

LinkSection.displayName = 'AgentShareLinkSection';

export default LinkSection;
