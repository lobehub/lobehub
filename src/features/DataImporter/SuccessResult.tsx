'use client';

import { Button, Flexbox, Icon } from '@lobehub/ui';
import { Result, Table } from 'antd';
import { createStaticStyles } from 'antd-style';
import { CheckCircle } from 'lucide-react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    zeroCell: css`
      color: ${cssVar.colorTextQuaternary};
    `,
  };
});

interface SuccessResultProps {
  dataSource?: {
    added: number;
    error: number;
    skips: number;
    title: string;
    updated: number;
  }[];
  duration: number;
  onClickFinish?: () => void;
}

const SuccessResult = memo<SuccessResultProps>(({ duration, dataSource, onClickFinish }) => {
  const { t } = useTranslation('common');

  const cellRender = (text: string) => {
    return text ? text : <span className={styles.zeroCell}>0</span>;
  };
  return (
    <Result
      icon={<Icon icon={CheckCircle} />}
      status={'success'}
      style={{ paddingBlock: 24, paddingInline: 0 }}
      title={t('importModal.finish.title')}
      extra={
        <Button size={'large'} type={'primary'} onClick={onClickFinish}>
          {t('importModal.finish.start')}
        </Button>
      }
      subTitle={
        // if there is no importData, means it's only import the settings
        !dataSource ? (
          t('importModal.finish.onlySettings')
        ) : (
          <Flexbox gap={16} width={500}>
            {t('importModal.finish.subTitle', { duration: (duration / 1000).toFixed(2) })}
            <Table
              bordered
              dataSource={dataSource}
              pagination={false}
              rowKey={'title'}
              size={'small'}
              columns={[
                { dataIndex: 'title', render: cellRender, title: t('importModal.result.type') },
                { dataIndex: 'added', render: cellRender, title: t('importModal.result.added') },
                { dataIndex: 'skips', render: cellRender, title: t('importModal.result.skips') },
                { dataIndex: 'error', render: cellRender, title: t('importModal.result.errors') },
                { dataIndex: 'updated', render: cellRender, title: t('importModal.result.update') },
              ]}
            />
          </Flexbox>
        )
      }
    />
  );
});

export default SuccessResult;
