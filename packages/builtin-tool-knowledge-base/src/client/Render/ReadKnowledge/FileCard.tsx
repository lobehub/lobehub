'use client';

import { Alert, Flexbox, Text } from '@lobehub/ui';
import { Descriptions } from 'antd';
import { createStaticStyles } from 'antd-style';
import { ComponentType, memo } from 'react';

import { FileContentDetail } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  cardBody: css`
    padding-block: 12px 8px;
    padding-inline: 16px;
  `,
  container: css`
    overflow: hidden;

    min-width: 360px;
    max-width: 360px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;
  `,
  description: css`
    margin-block: 0 4px !important;
    color: ${cssVar.colorTextTertiary};
  `,
  footer: css`
    padding-block: 8px;
    padding-inline: 16px;
    border-radius: 8px;

    text-align: center;

    background-color: ${cssVar.colorFillQuaternary};
  `,
  footerText: css`
    font-size: 12px !important;
    color: ${cssVar.colorTextTertiary} !important;
  `,
  icon: css`
    color: ${cssVar.colorTextSecondary};
  `,
  preview: css`
    overflow: hidden;

    max-height: 80px;
    padding: 8px;
    border-radius: 6px;

    line-height: 1.5;
  `,
  title: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    margin-block-end: 0;
  `,
  titleRow: css`
    color: ${cssVar.colorText};
  `,
}));

interface FileCardProps {
  FileIcon: ComponentType<{ fileName: string; size: number }>;
  file: FileContentDetail;
  labels: {
    chars: string;
    lines: string;
  };
}

const FileCard = memo<FileCardProps>(({ file, FileIcon, labels }) => {
  if (file.error) {
    return (
      <Flexbox className={styles.container} gap={8}>
        <Flexbox className={styles.cardBody} gap={8}>
          <Flexbox align={'center'} className={styles.titleRow} gap={8} horizontal>
            <FileIcon fileName={file.filename} size={16} />
            <div className={styles.title}>{file.filename}</div>
          </Flexbox>
        </Flexbox>
        <div className={styles.footer}>
          <Alert message={file.error} type={'error'} variant={'borderless'} />
        </div>
      </Flexbox>
    );
  }

  return (
    <Flexbox className={styles.container} justify={'space-between'}>
      <Flexbox className={styles.cardBody} gap={8}>
        <Flexbox align={'center'} className={styles.titleRow} gap={8} horizontal>
          <FileIcon fileName={file.filename} size={16} />
          <div className={styles.title}>{file.filename}</div>
        </Flexbox>
        {file.preview && (
          <Text
            as={'span'}
            className={styles.preview}
            code
            ellipsis={{ rows: 4 }}
            fontSize={12}
            type={'secondary'}
          >
            {file.preview}...
          </Text>
        )}
      </Flexbox>
      <div className={styles.footer}>
        <Descriptions
          classNames={{
            content: styles.footerText,
            label: styles.footerText,
          }}
          column={2}
          items={[
            {
              children: file.totalCharCount?.toLocaleString(),
              label: labels.chars,
            },
            {
              children: file.totalLineCount?.toLocaleString(),
              label: labels.lines,
            },
          ]}
          size="small"
        />
      </div>
    </Flexbox>
  );
});

export default FileCard;
