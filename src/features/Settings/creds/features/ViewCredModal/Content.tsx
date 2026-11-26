'use client';

import { type UserCredSummary } from '@lobechat/types';
import {
  ActionIcon,
  Alert,
  Button,
  CopyButton,
  Flexbox,
  Icon,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useQuery } from '@tanstack/react-query';
import { Eye, EyeOff, type LucideIcon } from 'lucide-react';
import { type FC, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SkeletonBar from '@/components/Skeleton/Bar';

import { confirmCredModal } from '../confirmCredModal';
import { type CredsApi } from '../useCredsApi';

// The theme's card border (light: colorFill, dark: colorFillSecondary), the
// line Surface draws; colorBorderSecondary vanishes on a dark modal.
const FIELD_BORDER = 'var(--lobe-fill-border)';

const styles = stylex.create({
  code: { fontFamily: cssVar.fontFamilyCode, fontSize: '13px' },
  fields: {
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: FIELD_BORDER,
    borderRadius: cssVar.borderRadiusLG,
  },
  footer: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBlockStart: '20px',
  },
  label: {
    overflow: 'hidden',
    flexShrink: 0,
    width: '96px',
    fontSize: '13px',
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  // A stored value's name (`OPENAI_API_KEY`) keeps its full width up to half the row.
  labelFit: { width: 'auto', minWidth: '96px', maxWidth: '50%' },
  masked: { letterSpacing: '2px' },
  row: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    minHeight: '44px',
    paddingBlock: '8px',
    paddingInline: '14px',
    borderBlockEndWidth: { 'default': '1px', ':last-child': '0' },
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: FIELD_BORDER,
  },
  value: {
    overflow: 'hidden',
    flex: '1',
    minWidth: 0,
    fontSize: '14px',
    color: cssVar.colorText,
    overflowWrap: 'anywhere',
  },
});

const MASK = '••••••••••••';

interface FieldRowProps {
  children: ReactNode;
  extra?: ReactNode;
  /** Let a long label (`Credential Values`) take the width it needs, like a value name. */
  fitLabel?: boolean;
  label: ReactNode;
  mono?: boolean;
}

const FieldRow: FC<FieldRowProps> = ({ children, extra, fitLabel, label, mono }) => (
  <div {...stylex.props(styles.row)}>
    <div
      {...stylex.props(styles.label, mono && styles.code, (mono || fitLabel) && styles.labelFit)}
      title={mono && typeof label === 'string' ? label : undefined}
    >
      {label}
    </div>
    <div {...stylex.props(styles.value, mono && styles.code)}>{children}</div>
    {extra}
  </div>
);

/** One stored value: masked until revealed, copyable either way. */
const SecretRow: FC<{ name: string; value: string }> = ({ name, value }) => {
  const { t } = useTranslation('setting');
  // Rows appear only after the viewer asked to see the values.
  const [visible, setVisible] = useState(true);

  return (
    <FieldRow
      mono
      label={name}
      extra={
        <Flexbox horizontal align={'center'} gap={2}>
          <ActionIcon
            icon={visible ? EyeOff : Eye}
            size={'small'}
            title={t(visible ? 'creds.view.hide' : 'creds.view.show')}
            onClick={() => setVisible(!visible)}
          />
          <CopyButton content={value} size={'small'} />
        </Flexbox>
      }
    >
      <span {...stylex.props(styles.code, !visible && styles.masked)}>
        {visible ? value : MASK}
      </span>
    </FieldRow>
  );
};

/** A row-specific action (share, publish, unshare…) offered in the detail footer. */
export interface CredDetailAction {
  /** Danger actions sit on the left beside Remove (red fill); the rest before Edit. */
  danger?: boolean;
  icon?: LucideIcon;
  key: string;
  label: string;
  onClick: () => void;
}

export interface ViewCredModalContentProps {
  /** Row-specific actions; each closes the detail before it runs. */
  actions?: CredDetailAction[];
  /** Whether a key-value item's stored values may be decrypted and shown. */
  canReadValues?: boolean;
  cred: UserCredSummary;
  credsApi: CredsApi;
  /** Host-specific fields after the item's own, e.g. the workspace visibility and owner. */
  extraItems?: CredDetailItem[];
  /** Removes the item after a confirmation; no Remove button when omitted. */
  onDelete?: (id: number) => Promise<unknown>;
  /** Opens the edit form; no Edit button when omitted. */
  onEdit?: (cred: UserCredSummary) => void;
  /** Shown instead of the values when they exist but may not be read (write-only). */
  valuesHint?: string;
}

/** One extra field row in the detail. */
export interface CredDetailItem {
  children: ReactNode;
  key: string;
  label: ReactNode;
}

/**
 * A vault item opened from its row: its fields as one bordered list (a
 * key-value item's stored values included, masked), with Remove on the left of
 * the footer and Edit / Done on the right. Every button but Done is the fill variant.
 */
const ViewCredModalContent: FC<ViewCredModalContentProps> = ({
  actions = [],
  canReadValues = false,
  cred,
  credsApi,
  extraItems = [],
  onDelete,
  onEdit,
  valuesHint,
}) => {
  const { t } = useTranslation('setting');
  const { close } = useModalContext();
  const isKV = cred.type === 'kv-env' || cred.type === 'kv-header';
  const showValues = isKV && canReadValues;
  // Plaintext is decrypted only once the viewer asks for it, not on open.
  const [revealed, setRevealed] = useState(false);

  const { data, isLoading, error } = useQuery({
    enabled: showValues && revealed,
    queryFn: () => credsApi.client.get.query({ decrypt: true, id: cred.id }),
    queryKey: ['cred-plaintext', cred.id],
  });

  const values = Object.entries<string>((data as any)?.plaintext ?? {});

  const handleRemove = () => {
    if (!onDelete) return;
    confirmCredModal({
      content: t('creds.actions.deleteConfirm.content'),
      danger: true,
      okText: t('creds.actions.deleteConfirm.ok'),
      onOk: async () => {
        try {
          await onDelete(cred.id);
          close();
        } catch {
          toast.error(t('creds.errors.deleteFailed'));
        }
      },
      title: t('creds.actions.deleteConfirm.title'),
    });
  };

  const runAction = (action: CredDetailAction) => () => {
    close();
    action.onClick();
  };

  const renderAction = (action: CredDetailAction) => (
    <Button
      danger={action.danger}
      icon={action.icon ? <Icon icon={action.icon} /> : undefined}
      key={action.key}
      type={'fill'}
      onClick={runAction(action)}
    >
      {action.label}
    </Button>
  );

  const handleEdit = () => {
    close();
    onEdit?.(cred);
  };

  return (
    <>
      <div {...stylex.props(styles.fields)}>
        <FieldRow label={t('creds.table.type')}>{t(`creds.types.${cred.type}`)}</FieldRow>
        {cred.type === 'oauth' && cred.oauthUsername && (
          <FieldRow label={t('creds.detail.account')}>{cred.oauthUsername}</FieldRow>
        )}
        {cred.type === 'file' && cred.fileName && (
          <FieldRow label={t('creds.form.file')}>{cred.fileName}</FieldRow>
        )}
        {extraItems.map((item) => (
          <FieldRow key={item.key} label={item.label}>
            {item.children}
          </FieldRow>
        ))}
        {cred.description && (
          <FieldRow label={t('creds.form.description')}>{cred.description}</FieldRow>
        )}
        {isKV && !showValues && valuesHint && (
          <FieldRow fitLabel label={t('creds.view.values')}>
            {valuesHint}
          </FieldRow>
        )}
        {showValues &&
          (!revealed ? (
            <FieldRow
              fitLabel
              label={t('creds.view.values')}
              extra={
                <Button
                  icon={<Icon icon={Eye} />}
                  size={'small'}
                  type={'text'}
                  onClick={() => setRevealed(true)}
                >
                  {t('creds.view.showValues')}
                </Button>
              }
            >
              <span {...stylex.props(styles.code, styles.masked)}>{MASK}</span>
            </FieldRow>
          ) : isLoading ? (
            <FieldRow label={<SkeletonBar height={12} width={72} />}>
              <SkeletonBar height={12} width={160} />
            </FieldRow>
          ) : (
            values.map(([name, value]) => (
              <SecretRow key={name} name={name} value={String(value)} />
            ))
          ))}
      </div>

      {error && (
        <Alert
          showIcon
          description={(error as Error).message}
          message={t('creds.view.error')}
          style={{ marginTop: 12 }}
          type={'error'}
        />
      )}

      <div {...stylex.props(styles.footer)}>
        <Flexbox horizontal align={'center'} gap={8}>
          {onDelete && (
            <Button danger type={'fill'} onClick={handleRemove}>
              {t('creds.actions.remove')}
            </Button>
          )}
          {actions.filter((action) => action.danger).map(renderAction)}
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={8} style={{ marginInlineStart: 'auto' }}>
          {actions.filter((action) => !action.danger).map(renderAction)}
          {onEdit && (
            <Button type={'fill'} onClick={handleEdit}>
              {t('creds.actions.edit')}
            </Button>
          )}
          <Button type={'primary'} onClick={close}>
            {t('creds.actions.done')}
          </Button>
        </Flexbox>
      </div>
    </>
  );
};

export default ViewCredModalContent;
