'use client';

import { type UserCredSummary } from '@lobechat/types';
import { CopyButton } from '@lobehub/ui';
import { useQuery } from '@tanstack/react-query';
import { Alert, Descriptions, Modal, Skeleton, Typography } from 'antd';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaClient } from '@/libs/trpc/client';

const { Text } = Typography;

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

  const values = (data as any)?.values || {};
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
            <Descriptions
              bordered
              column={1}
              size="small"
              style={{ marginTop: 16 }}
              title={t('creds.view.values')}
            >
              {valueEntries.map(([key, value]) => (
                <Descriptions.Item
                  contentStyle={{ display: 'flex', alignItems: 'center', gap: 8 }}
                  key={key}
                  label={key}
                  labelStyle={{ width: 120 }}
                >
                  <Text
                    copyable={false}
                    style={{
                      flex: 1,
                      fontFamily: 'monospace',
                      fontSize: 12,
                      wordBreak: 'break-all',
                    }}
                  >
                    {String(value)}
                  </Text>
                  <CopyButton content={String(value)} size="small" />
                </Descriptions.Item>
              ))}
            </Descriptions>
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
