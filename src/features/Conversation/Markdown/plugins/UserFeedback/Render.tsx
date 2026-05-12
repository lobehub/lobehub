import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { MessageSquareText } from 'lucide-react';
import { memo, useMemo } from 'react';

import { type MarkdownElementProps } from '../type';
import { type ParsedUserFeedbackComment, parseUserFeedback } from './parseUserFeedback';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-inline-start: 2px solid ${cssVar.colorBorderSecondary};
    border-radius: 4px;

    background: ${cssVar.colorFillQuaternary};
  `,
  comment: css`
    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorText};
    word-break: break-word;
    white-space: pre-wrap;
  `,
  header: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  time: css`
    flex: none;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

const Comment = memo<{ comment: ParsedUserFeedbackComment }>(({ comment }) => (
  <Flexbox gap={2}>
    {comment.time && <span className={styles.time}>{comment.time}</span>}
    <div className={styles.comment}>{comment.content}</div>
  </Flexbox>
));

Comment.displayName = 'UserFeedbackComment';

const Render = memo<MarkdownElementProps>(({ children }) => {
  const text = typeof children === 'string' ? children : String(children ?? '');
  const comments = useMemo(() => parseUserFeedback(text), [text]);

  if (comments.length === 0) return null;

  return (
    <Flexbox className={styles.card} gap={8}>
      <Flexbox horizontal align={'center'} className={styles.header} gap={6}>
        <MessageSquareText size={12} />
        <Text fontSize={12} type={'secondary'}>
          User feedback · {comments.length === 1 ? '1 comment' : `${comments.length} comments`}
        </Text>
      </Flexbox>

      <Flexbox gap={8}>
        {comments.map((comment, idx) => (
          <Comment comment={comment} key={comment.id ?? idx} />
        ))}
      </Flexbox>
    </Flexbox>
  );
});

Render.displayName = 'UserFeedbackRender';

export default Render;
