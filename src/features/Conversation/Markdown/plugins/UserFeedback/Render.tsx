import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { MessageSquareText } from 'lucide-react';
import { memo, useMemo } from 'react';

import { type MarkdownElementProps } from '../type';
import { type ParsedUserFeedbackComment, parseUserFeedback } from './parseUserFeedback';

const styles = createStaticStyles(({ css, cssVar }) => ({
  comment: css`
    font-size: 13px;
    line-height: 1.7;
    color: ${cssVar.colorText};
    word-break: break-word;
    white-space: pre-wrap;
  `,
  divider: css`
    inline-size: 100%;
    block-size: 1px;
    background: ${cssVar.colorSplit};
  `,
  headerIcon: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    inline-size: 32px;
    block-size: 32px;

    color: ${cssVar.colorTextSecondary};
  `,
}));

const Comment = memo<{ comment: ParsedUserFeedbackComment }>(({ comment }) => (
  <Flexbox gap={2}>
    {comment.time && (
      <Text fontSize={12} type={'secondary'}>
        {comment.time}
      </Text>
    )}
    <div className={styles.comment}>{comment.content}</div>
  </Flexbox>
));

Comment.displayName = 'UserFeedbackComment';

const Render = memo<MarkdownElementProps>(({ children }) => {
  const text = typeof children === 'string' ? children : String(children ?? '');
  const comments = useMemo(() => parseUserFeedback(text), [text]);

  if (comments.length === 0) return null;

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align={'center'} gap={12}>
        <span className={styles.headerIcon}>
          <MessageSquareText size={16} />
        </span>
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <Text weight={500}>User feedback</Text>
          <Text fontSize={12} type={'secondary'}>
            {comments.length === 1 ? '1 comment' : `${comments.length} comments`}
          </Text>
        </Flexbox>
      </Flexbox>

      <div className={styles.divider} />

      <Flexbox gap={12}>
        {comments.map((comment, idx) => (
          <Comment comment={comment} key={comment.id ?? idx} />
        ))}
      </Flexbox>
    </Flexbox>
  );
});

Render.displayName = 'UserFeedbackRender';

export default Render;
