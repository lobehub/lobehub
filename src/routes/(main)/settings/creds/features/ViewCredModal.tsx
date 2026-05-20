'use client';

import { type UserCredSummary } from '@lobechat/types';
import { CopyButton, Flexbox } from '@lobehub/ui';
import { useQuery } from '@tanstack/react-query';
import { Alert, Descriptions, Modal, Skeleton, Typography } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import { Eye, EyeOff } from 'lucide-react';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaClient } from '@/libs/trpc/client';

const { Text } = Typography;

const styles = createStaticStyles(({ css, cssVar }) => ({
  kvKey: css`
    min-width: 140px;
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadius} 0 0 ${cssVar.borderRadius};

    font-family: ${cssVar.fontFamilyCode};
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillQuaternary};
  `,
  kvRow: css`
    display: flex;
    align-items: stretch;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    &:not(:last-child) {
      margin-block-end: 8px;
    }
  `,
  kvValue: css`
    display: flex;
    flex: 1;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    padding-block: 8px;
    padding-inline: 12px;
    border-radius: 0 ${cssVar.borderRadius} ${cssVar.borderRadius} 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 13px;

    background: ${cssVar.colorBgContainer};
  `,
  maskedValue: css`
    color: ${cssVar.colorTextQuaternary};
    letter-spacing: 2px;
  `,
  toggleBtn: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    padding: 4px;
    border-radius: ${cssVar.borderRadiusSM};

    color: ${cssVar.colorTextTertiary};

    transition: all 0.2s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  valuesSection: css`
    margin-block-start: 16px;
  `,
  valuesTitle: css`
    margin-block-end: 12px;
    font-weight: 500;
  `,
}));

// Mask value like "sk-****xxxx"
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
    <div className={styles.kvRow}>
      <div className={styles.kvKey}>{keyName}</div>
      <div className={styles.kvValue}>
        <Text
          className={cx(!visible && styles.maskedValue)}
          style={{
            flex: 1,
            fontFamily: 'var(--lobe-font-family-code)',
            fontSize: 13,
            wordBreak: 'break-all',
          }}
        >
          {visible ? value : maskValue(value)}
        </Text>
        <Flexbox horizontal align="center" gap={4}>
          <div className={styles.toggleBtn} onClick={() => setVisible(!visible)}>
            {visible ? <EyeOff size={16} /> : <Eye size={16} />}
          </div>
          <CopyButton content={value} size="small" />
        </Flexbox>
      </div>
    </div>
  );
};

interface ViewCredModalProps {
  cred: UserCredSummary | null;
  onClose: () => void;
  open: boolean;
}

const ViewCredModal: FC<ViewCredModalProps> = ({ cred, open, onClose }) => {
  const { t } = useTranslation('setting');

  const { data, isLoading, error } = useQuery({
    enabled: open && !!cred,
    queryFn: () =>
      lambdaClient.market.creds.get.query({
        decrypt: true,
        id: cred!.id,
      }),
    queryKey: ['cred-plaintext', cred?.id],
  });

  const values = (data as any)?.plaintext || {};
  const valueEntries = Object.entries(values);

  return (
    <Modal
      footer={null}
      open={open}
      title={t('creds.view.title', { name: cred?.name })}
      width={560}
      onCancel={onClose}
    >
      {isLoading ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : error ? (
        <Alert
          showIcon
          description={(error as Error).message}
          message={t('creds.view.error')}
          type="error"
        />
      ) : (
        <>
          <Alert
            showIcon
            message={t('creds.view.warning')}
            style={{ marginBottom: 16 }}
            type="warning"
          />
          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label={t('creds.table.name')}>{cred?.name}</Descriptions.Item>
            <Descriptions.Item label={t('creds.table.key')}>
              <code>{cred?.key}</code>
            </Descriptions.Item>
            <Descriptions.Item label={t('creds.table.type')}>
              {cred?.type ? t(`creds.types.${cred.type}` as any) : '-'}
            </Descriptions.Item>
          </Descriptions>

          {valueEntries.length > 0 && (
            <div className={styles.valuesSection}>
              <div className={styles.valuesTitle}>{t('creds.view.values')}</div>
              {valueEntries.map(([key, value]) => (
                <KVRow key={key} keyName={key} value={String(value)} />
              ))}
            </div>
          )}

          {valueEntries.length === 0 && cred?.type === 'oauth' && (
            <Alert
              showIcon
              description={t('creds.view.oauthNote')}
              message={t('creds.view.noValues')}
              style={{ marginTop: 16 }}
              type="info"
            />
          )}
        </>
      )}
    </Modal>
  );
};

export default ViewCredModal;
