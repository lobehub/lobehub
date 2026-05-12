import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { MessageSquareText } from 'lucide-react';
import { memo, useMemo } from 'react';

import { type MarkdownElementProps } from '../type';
import { type ParsedUserFeedbackComment, parseUserFeedback } from './parseUserFeedback';

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    padding-block-start: 12px;
    padding-inline-start: 44px;
  `,
  comment: css`
    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorText};
    word-break: break-word;
    white-space: pre-wrap;
  `,
  countBadge: css`
    flex: none;

    padding-block: 1px;
    padding-inline: 6px;
    border-radius: 4px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillQuaternary};
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
  root: css`
    /* Override @lobehub/ui Markdown's default <details> card chrome (bg + padding + box-shadow).
       Need !important because the lib targets via .parent details (higher specificity).
       padding-bottom puts a 12px gap above the divider; margin-bottom puts a 12px gap below it,
       matching the symmetric 12px the task card uses around its own internal divider. */
    margin-block: 0 12px !important;
    padding-block: 0 12px !important;
    padding-inline: 0 !important;
    border-block-end: 1px solid ${cssVar.colorSplit} !important;
    border-radius: 0 !important;

    background: transparent !important;
    box-shadow: none !important;
  `,
  summary: css`
    cursor: pointer;
    list-style: none;

    &::-webkit-details-marker {
      display: none;
    }
  `,
  time: css`
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

  const countLabel = comments.length === 1 ? '1 comment' : `${comments.length} comments`;

  return (
    <details className={styles.root}>
      <summary className={styles.summary}>
        <Flexbox horizontal align={'center'} gap={12}>
          <span className={styles.headerIcon}>
            <MessageSquareText size={16} />
          </span>
          <Flexbox horizontal align={'center'} flex={1} gap={8} style={{ minWidth: 0 }}>
            <Text ellipsis weight={500}>
              User feedback
            </Text>
            <span className={styles.countBadge}>{countLabel}</span>
          </Flexbox>
        </Flexbox>
      </summary>
      <Flexbox className={styles.body} gap={12}>
        {comments.map((comment, idx) => (
          <Comment comment={comment} key={comment.id ?? idx} />
        ))}
      </Flexbox>
    </details>
  );
});

Render.displayName = 'UserFeedbackRender';

export default Render;
