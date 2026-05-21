'use client';

import type { SharedDocumentData } from '@lobechat/types';
import { Markdown } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { type FC } from 'react';

const useStyles = createStyles(({ css, token }) => ({
  emoji: css`
    margin-block-end: 12px;
    font-size: 36px;
    line-height: 1;
  `,
  empty: css`
    padding-block: 64px;
    padding-inline: 0;
    color: ${token.colorTextTertiary};
    text-align: center;
  `,
  title: css`
    margin-block: 0 24px;
    margin-inline: 0;

    font-size: 32px;
    font-weight: 700;
    color: ${token.colorText};
  `,
}));

interface ReadOnlyPageViewerProps {
  data: SharedDocumentData;
}

const ReadOnlyPageViewer: FC<ReadOnlyPageViewerProps> = ({ data }) => {
  const { styles } = useStyles();
  const emoji = (data.document.metadata as Record<string, unknown> | null)?.emoji as
    | string
    | undefined;

  const content = data.document.content;

  return (
    <article>
      {emoji && <div className={styles.emoji}>{emoji}</div>}
      <h1 className={styles.title}>{data.document.title ?? 'Untitled'}</h1>
      {content ? <Markdown>{content}</Markdown> : <div className={styles.empty}>—</div>}
    </article>
  );
};

export default ReadOnlyPageViewer;
