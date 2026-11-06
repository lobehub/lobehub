'use client';

import { Alert, Descriptions, Flexbox, MaterialFileTypeIcon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import type { FileContentDetail } from '../../../types';

const styles = stylex.create({
  cardBody: {
    paddingBlockStart: '12px',
    paddingBlockEnd: '8px',
    paddingInline: '16px',
  },
  container: {
    overflow: 'hidden',
    minWidth: '360px',
    maxWidth: '360px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '12px',
  },
  footer: {
    paddingBlock: '8px',
    paddingInline: '16px',
    borderRadius: '8px',
    textAlign: 'center',
    backgroundColor: cssVar.colorFillQuaternary,
  },
  footerText: {
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  preview: {
    overflow: 'hidden',
    maxHeight: '80px',
    paddingBlock: '8px',
    paddingInline: '8px',
    borderRadius: '6px',
    lineHeight: 1.5,
  },
  title: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 1,
    marginBlockEnd: 0,
  },
  titleRow: {
    color: cssVar.colorText,
  },
});

interface FileCardProps {
  file: FileContentDetail;
}

const FileCard = memo<FileCardProps>(({ file }) => {
  if (file.error) {
    return (
      <Flexbox className={stylex.props(styles.container).className} gap={8}>
        <Flexbox className={stylex.props(styles.cardBody).className} gap={8}>
          <Flexbox
            horizontal
            align={'center'}
            className={stylex.props(styles.titleRow).className}
            gap={8}
          >
            <MaterialFileTypeIcon
              filename={file.filename}
              size={16}
              type={'file'}
              variant={'raw'}
            />
            <div {...stylex.props(styles.title)}>{file.filename}</div>
          </Flexbox>
        </Flexbox>
        <div {...stylex.props(styles.footer)}>
          <Alert message={file.error} type={'error'} variant={'borderless'} />
        </div>
      </Flexbox>
    );
  }

  return (
    <Flexbox className={stylex.props(styles.container).className} justify={'space-between'}>
      <Flexbox className={stylex.props(styles.cardBody).className} gap={8}>
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(styles.titleRow).className}
          gap={8}
        >
          <MaterialFileTypeIcon filename={file.filename} size={16} type={'file'} variant={'raw'} />
          <div {...stylex.props(styles.title)}>{file.filename}</div>
        </Flexbox>
        {file.preview && (
          <Text
            code
            as={'span'}
            className={stylex.props(styles.preview).className}
            ellipsis={{ rows: 4 }}
            fontSize={12}
            type={'secondary'}
          >
            {file.preview}...
          </Text>
        )}
      </Flexbox>
      <div {...stylex.props(styles.footer)}>
        <Descriptions
          column={2}
          classNames={{
            content: stylex.props(styles.footerText).className,
            label: stylex.props(styles.footerText).className,
          }}
          items={[
            {
              children: file.totalCharCount?.toLocaleString(),
              label: 'Chars',
            },
            {
              children:
                file.startLine && file.endLine && (file.truncated || file.startLine > 1)
                  ? `${file.startLine.toLocaleString()}-${file.endLine.toLocaleString()} / ${file.totalLineCount?.toLocaleString()}`
                  : file.totalLineCount?.toLocaleString(),
              label: 'Lines',
            },
          ]}
        />
      </div>
    </Flexbox>
  );
});

export default FileCard;
