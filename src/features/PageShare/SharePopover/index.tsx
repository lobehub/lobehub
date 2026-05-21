'use client';

import type { DocumentSharePermission, DocumentShareVisibility } from '@lobechat/types';
import { Button, Flexbox, Input, Popover } from '@lobehub/ui';
import { App } from 'antd';
import { createStyles } from 'antd-style';
import { CheckIcon, CopyIcon, EyeIcon } from 'lucide-react';
import { type FC, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR, { mutate as globalMutate } from 'swr';

import { lambdaClient } from '@/libs/trpc/client';

import AccessSelect, { type AccessValue } from './AccessSelect';

const useStyles = createStyles(({ css, token }) => ({
  description: css`
    margin-block: 0 16px;
    margin-inline: 0;

    font-size: 12px;
    line-height: 1.5;
    color: ${token.colorTextTertiary};
  `,
  divider: css`
    height: 1px;
    margin-block: 16px;
    margin-inline: 0;
    background: ${token.colorBorderSecondary};
  `,
  linkInput: css`
    flex: 1;
    font-family: ${token.fontFamilyCode};
    font-size: 12px;
  `,
  popoverContent: css`
    width: 360px;
    padding: 4px;
  `,
  sectionLabel: css`
    margin-block-end: 8px;
    font-size: 12px;
    font-weight: 500;
    color: ${token.colorTextTertiary};
  `,
  title: css`
    margin-block: 0 4px;
    margin-inline: 0;
    font-size: 14px;
    font-weight: 600;
  `,
  views: css`
    display: flex;
    gap: 6px;
    align-items: center;

    font-size: 11px;
    color: ${token.colorTextTertiary};
  `,
}));

interface SharePopoverProps {
  children: ReactNode;
  documentId: string;
}

const SHARE_SETTINGS_KEY = (id: string) => ['document.getShareSettings', id];

const toAccessValue = (
  visibility: DocumentShareVisibility,
  permission: DocumentSharePermission,
): AccessValue => {
  if (visibility === 'private') return 'private';
  if (permission === 'read') return 'link-read';
  if (permission === 'comment') return 'link-comment';
  return 'link-edit';
};

const fromAccessValue = (
  value: AccessValue,
): {
  permission: DocumentSharePermission;
  visibility: DocumentShareVisibility;
} => {
  if (value === 'private') return { permission: 'read', visibility: 'private' };
  if (value === 'link-comment') return { permission: 'comment', visibility: 'link' };
  if (value === 'link-edit') return { permission: 'edit', visibility: 'link' };
  return { permission: 'read', visibility: 'link' };
};

const SharePopover: FC<SharePopoverProps> = ({ children, documentId }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('pageShare');
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [justCopied, setJustCopied] = useState(false);

  const { data: settings, mutate: refetchSettings } = useSWR(
    open ? SHARE_SETTINGS_KEY(documentId) : null,
    () => lambdaClient.document.getShareSettings.query({ id: documentId }),
  );

  const current: AccessValue = settings
    ? toAccessValue(
        settings.visibility as DocumentShareVisibility,
        settings.permission as DocumentSharePermission,
      )
    : 'private';

  const isShared = current !== 'private';
  const shareUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/page/${documentId}` : '';

  const handleChange = async (value: AccessValue) => {
    const { permission, visibility } = fromAccessValue(value);
    await lambdaClient.document.updateShareSettings.mutate({
      id: documentId,
      permission: 'read',
      visibility,
    });
    if (permission !== 'read') {
      // Comment/edit not supported in v1 — silently coerced to read by server.
      void 0;
    }
    await refetchSettings();
    // Invalidate guest probe cache too so an open guest tab refetches.
    void globalMutate(['share.getSharedDocument', documentId]);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setJustCopied(true);
      message.success(t('popover.copied'));
      setTimeout(() => setJustCopied(false), 2000);
    } catch {
      message.error(t('popover.copyFailed'));
    }
  };

  return (
    <Popover
      open={open}
      placement={'bottomRight'}
      styles={{ content: { padding: 16 } }}
      trigger={'click'}
      content={
        <div className={styles.popoverContent}>
          <h4 className={styles.title}>{t('popover.title')}</h4>
          <p className={styles.description}>{t('popover.description')}</p>

          <div className={styles.sectionLabel}>{t('popover.sectionAccess')}</div>
          <AccessSelect value={current} onChange={handleChange} />

          <div className={styles.divider} />

          <div className={styles.sectionLabel}>{t('popover.sectionLink')}</div>
          <Flexbox horizontal gap={6}>
            <Input
              readOnly
              className={styles.linkInput}
              value={isShared ? shareUrl : t('popover.linkPrivatePlaceholder')}
            />
            <Button disabled={!isShared} onClick={handleCopy}>
              {justCopied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
              <span style={{ marginLeft: 4 }}>{t('popover.copy')}</span>
            </Button>
          </Flexbox>

          <div className={styles.divider} />

          <Flexbox horizontal align={'center'} justify={'space-between'}>
            <span className={styles.views}>
              <EyeIcon size={12} />
              {t('popover.sectionViews', { count: settings?.pageViewCount ?? 0 })}
            </span>
            {isShared && (
              <a href={shareUrl} rel={'noreferrer'} style={{ fontSize: 12 }} target={'_blank'}>
                {t('popover.openInNewTab')}
              </a>
            )}
          </Flexbox>
        </div>
      }
      onOpenChange={setOpen}
    >
      {children}
    </Popover>
  );
};

export default SharePopover;
