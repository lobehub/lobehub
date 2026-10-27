'use client';

import { type UserCredSummary } from '@lobechat/types';
import { Alert, CopyButton, Descriptions, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useQuery } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ArticleSkeleton } from '@/components/Skeleton';

import { type CredsApi } from '../useCredsApi';

const styles = stylex.create({
  kvKey: {
    minWidth: '140px',
    paddingBlock: '8px',
    paddingInline: '12px',
    borderTopLeftRadius: cssVar.borderRadius,
    borderTopRightRadius: '0',
    borderBottomRightRadius: '0',
    borderBottomLeftRadius: cssVar.borderRadius,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '13px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  kvRow: {
    display: 'flex',
    alignItems: 'stretch',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    marginBlockEnd: { 'default': null, ':not(:last-child)': '8px' },
  },
  kvValue: {
    display: 'flex',
    flex: '1',
    gap: '8px',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBlock: '8px',
    paddingInline: '12px',
    borderTopLeftRadius: '0',
    borderTopRightRadius: cssVar.borderRadius,
    borderBottomRightRadius: cssVar.borderRadius,
    borderBottomLeftRadius: '0',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '13px',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  maskedValue: { color: cssVar.colorTextQuaternary, letterSpacing: '2px' },
  toggleBtn: {
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px',
    borderRadius: cssVar.borderRadiusSM,
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    transition: 'all 0.2s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  valuesSection: { marginBlockStart: '16px' },
  valuesTitle: { marginBlockEnd: '12px', fontWeight: 500 },
});

const maskValue = (value: string): string => {
  if (value.length <= 4) return '••••••••';
  return '••••••••' + value.slice(-4);
};

interface KVRowProps {
  keyName: string;
  value: string;
}

const KVRow: FC<KVRowProps> = ({ keyName, value }) => {
  const [visible, setVisible] = useState(false);

  return (
    <div {...stylex.props(styles.kvRow)}>
      <div {...stylex.props(styles.kvKey)}>{keyName}</div>
      <div {...stylex.props(styles.kvValue)}>
        <Text
          as={'span'}
          className={stylex.props(!visible && styles.maskedValue).className}
          style={{
            flex: 1,
            fontFamily: 'var(--lobe-font-family-code)',
            fontSize: 13,
            wordBreak: 'break-all',
          }}
        >
          {visible ? value : maskValue(value)}
        </Text>
        <Flexbox horizontal align={'center'} gap={4}>
          <div {...stylex.props(styles.toggleBtn)} onClick={() => setVisible(!visible)}>
            {visible ? <EyeOff size={16} /> : <Eye size={16} />}
          </div>
          <CopyButton content={value} size={'small'} />
        </Flexbox>
      </div>
    </div>
  );
};

export interface ViewCredModalContentProps {
  cred: UserCredSummary;
  /**
   * Bound explicitly by the caller (rendered inline, inside CredsApiProvider)
   * instead of read via useCredsApi() here — this content tree is portaled by
   * createModal() to a global ModalHost that sits outside CredsApiProvider,
   * so a local useCredsApi() call would silently fall back to the personal
   * (market.creds) API even on the workspace creds page.
   */
  credsApi: CredsApi;
}

const ViewCredModalContent: FC<ViewCredModalContentProps> = ({ cred, credsApi }) => {
  const { t } = useTranslation('setting');

  const { data, isLoading, error } = useQuery({
    queryFn: () =>
      credsApi.client.get.query({
        decrypt: true,
        id: cred.id,
      }),
    queryKey: ['cred-plaintext', cred.id],
  });

  const values = (data as any)?.plaintext || {};
  const valueEntries = Object.entries(values);

  if (isLoading) {
    return <ArticleSkeleton rows={3} />;
  }

  if (error) {
    return (
      <Alert
        showIcon
        description={(error as Error).message}
        message={t('creds.view.error')}
        type={'error'}
      />
    );
  }

  return (
    <>
      <Alert
        showIcon
        message={t('creds.view.warning')}
        style={{ marginBottom: 16 }}
        type={'warning'}
      />
      <Descriptions
        bordered
        items={[
          { children: cred.name, key: 'name', label: t('creds.table.name') },
          { children: <code>{cred.key}</code>, key: 'key', label: t('creds.table.key') },
          {
            children: cred.type ? t(`creds.types.${cred.type}` as any) : '-',
            key: 'type',
            label: t('creds.table.type'),
          },
        ]}
      />

      {valueEntries.length > 0 && (
        <div {...stylex.props(styles.valuesSection)}>
          <div {...stylex.props(styles.valuesTitle)}>{t('creds.view.values')}</div>
          {valueEntries.map(([key, value]) => (
            <KVRow key={key} keyName={key} value={String(value)} />
          ))}
        </div>
      )}

      {valueEntries.length === 0 && cred.type === 'oauth' && (
        <Alert
          showIcon
          description={t('creds.view.oauthNote')}
          message={t('creds.view.noValues')}
          style={{ marginTop: 16 }}
          type={'info'}
        />
      )}
    </>
  );
};

export default ViewCredModalContent;
