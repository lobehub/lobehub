'use client';

import { Button, Flexbox, Modal, Text } from '@lobehub/ui';
import { Table } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Info } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type ImportPgDataStructure } from '@/types/export';

const getNonEmptyTables = (data: ImportPgDataStructure) => {
  const result = [];

  for (const [key, value] of Object.entries(data.data)) {
    if (Array.isArray(value) && value.length > 0) {
      result.push({
        count: value.length,
        name: key,
      });
    }
  }

  return result;
};

const getTotalRecords = (tables: { count: number; name: string }[]): number => {
  return tables.reduce((sum, table) => sum + table.count, 0);
};

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    duplicateAlert: css`
      margin-block-start: ${cssVar.marginMD};
      padding: ${cssVar.paddingMD};
      border: 1px solid ${cssVar.colorWarningBorder};
      border-radius: ${cssVar.borderRadiusLG};

      background-color: ${cssVar.colorWarningBg};
    `,
    duplicateDescription: css`
      margin-block-start: ${cssVar.marginXS};
      font-size: ${cssVar.fontSizeSM};
      color: ${cssVar.colorTextSecondary};
    `,
    duplicateOptions: css`
      margin-block-start: ${cssVar.marginSM};
    `,
    duplicateTag: css`
      border-color: ${cssVar.colorWarningBorder};
      color: ${cssVar.colorWarning};
      background-color: ${cssVar.colorWarningBg};
    `,
    hash: css`
      font-family: ${cssVar.fontFamilyCode};
      font-size: 12px;
      color: ${cssVar.colorTextTertiary};
    `,
    infoIcon: css`
      color: ${cssVar.colorTextSecondary};
    `,
    modalContent: css`
      padding-block: ${cssVar.paddingMD};
      padding-inline: 0;
    `,
    successIcon: css`
      color: ${cssVar.colorSuccess};
    `,
    tableContainer: css`
      overflow: hidden;
      border: 1px solid ${cssVar.colorBorderSecondary};
      border-radius: ${cssVar.borderRadiusLG};
    `,
    tableName: css`
      font-family: ${cssVar.fontFamilyCode};
    `,
    warningIcon: css`
      color: ${cssVar.colorWarning};
    `,
  };
});

interface ImportPreviewModalProps {
  importData: ImportPgDataStructure;
  onCancel?: () => void;
  onConfirm?: (overwriteExisting: boolean) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

const ImportPreviewModal = ({
  open = true,
  onOpenChange = () => {},
  onConfirm = () => {},
  onCancel = () => {},
  importData,
}: ImportPreviewModalProps) => {
  const { t } = useTranslation('common');
  const [duplicateAction] = useState<string>('skip');
  const tables = getNonEmptyTables(importData);
  const totalRecords = getTotalRecords(tables);

  // 表格列定义
  const columns = [
    {
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <div className={styles.tableName}>{text}</div>,
      title: t('importPreview.tables.name'),
    },
    {
      dataIndex: 'count',
      key: 'count',
      title: t('importPreview.tables.count'),
    },
  ];

  const handleConfirm = () => {
    onConfirm(duplicateAction === 'overwrite');
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      title={t('importPreview.title')}
      width={700}
      footer={[
        <Button
          key="cancel"
          onClick={() => {
            onOpenChange(false);
            onCancel();
          }}
        >
          {t('cancel')}
        </Button>,
        <Button key="confirm" type="primary" onClick={handleConfirm}>
          {t('importPreview.confirmImport')}
        </Button>,
      ]}
      onCancel={() => onOpenChange(false)}
    >
      <div className={styles.modalContent}>
        <Flexbox gap={16}>
          <Flexbox gap={4}>
            <Flexbox horizontal align="center" justify="space-between" width="100%">
              <Flexbox horizontal align="center" gap={8}>
                <Info className={styles.infoIcon} size={16} />
                <Text strong>{t('importPreview.totalRecords', { count: totalRecords })}</Text>
              </Flexbox>
              <Flexbox horizontal>
                <Text type="secondary">
                  {t('importPreview.totalTables', { count: tables.length })}
                </Text>
              </Flexbox>
            </Flexbox>
            <Flexbox horizontal className={styles.hash} gap={4}>
              {t('importPreview.hashLabel')}: <span>{importData.schemaHash}</span>
            </Flexbox>
          </Flexbox>

          <div className={styles.tableContainer}>
            <Table
              columns={columns}
              dataSource={tables}
              pagination={false}
              rowKey="name"
              scroll={{ y: 350 }}
              size="small"
            />
          </div>
        </Flexbox>
      </div>
    </Modal>
  );
};

export default ImportPreviewModal;
