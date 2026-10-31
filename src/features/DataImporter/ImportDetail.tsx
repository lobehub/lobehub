'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, ModalFooter, Table, type TableColumn, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Info } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import ImperativeModal from '@/components/ImperativeModal';
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

const styles = stylex.create({
  hash: { fontFamily: cssVar.fontFamilyCode, fontSize: '12px', color: cssVar.colorTextTertiary },
  infoIcon: { color: cssVar.colorTextSecondary },
  modalContent: { paddingBlock: cssVar.paddingMD, paddingInline: '0' },
  tableContainer: {
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
  },
  tableName: { fontFamily: cssVar.fontFamilyCode },
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

  // Table column definitions
  const columns: TableColumn<{ count: number; name: string }>[] = [
    {
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <div {...stylex.props(styles.tableName)}>{text}</div>,
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
    <ImperativeModal
      open={open}
      title={t('importPreview.title')}
      width={700}
      footer={
        <ModalFooter>
          <Button
            onClick={() => {
              onOpenChange(false);
              onCancel();
            }}
          >
            {t('cancel')}
          </Button>
          <Button type="primary" onClick={handleConfirm}>
            {t('importPreview.confirmImport')}
          </Button>
        </ModalFooter>
      }
      onCancel={() => onOpenChange(false)}
    >
      <div {...stylex.props(styles.modalContent)}>
        <Flexbox gap={16}>
          <Flexbox gap={4}>
            <Flexbox horizontal align="center" justify="space-between" width="100%">
              <Flexbox horizontal align="center" gap={8}>
                <Info className={stylex.props(styles.infoIcon).className} size={16} />
                <Text strong>{t('importPreview.totalRecords', { count: totalRecords })}</Text>
              </Flexbox>
              <Flexbox horizontal>
                <Text type="secondary">
                  {t('importPreview.totalTables', { count: tables.length })}
                </Text>
              </Flexbox>
            </Flexbox>
            <Flexbox horizontal className={stylex.props(styles.hash).className} gap={4}>
              {t('importPreview.hashLabel')}: <span>{importData.schemaHash}</span>
            </Flexbox>
          </Flexbox>

          <div {...stylex.props(styles.tableContainer)}>
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
    </ImperativeModal>
  );
};

export default ImportPreviewModal;
