import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { MessageSquareText } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type MarkdownElementProps } from '../type';
import { type ParsedUserFeedbackComment, parseUserFeedback } from './parseUserFeedback';

const styles = stylex.create({
  body: { paddingBlockStart: '12px', paddingInlineStart: '44px' },
  comment: {
    fontSize: '13px',
    lineHeight: 1.6,
    color: cssVar.colorText,
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
  },
  countBadge: {
    flex: 'none',
    paddingBlock: '1px',
    paddingInline: '6px',
    borderRadius: '4px',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  headerIcon: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    inlineSize: '32px',
    blockSize: '32px',
    color: cssVar.colorTextSecondary,
  },
  // Override @lobehub/ui Markdown's default <details> card chrome (bg + padding +
  // box-shadow). The lib targets it via `.parent details`, but its rules sit in
  // the layered lobe-ui sheet, so these unlayered rules win without !important.
  // paddingBlockEnd puts a 12px gap above the divider; marginBlockEnd puts a 12px
  // gap below it, matching the symmetric 12px the task card uses around its own
  // internal divider.
  root: {
    marginBlockStart: 0,
    marginBlockEnd: '12px',
    paddingBlockStart: 0,
    paddingBlockEnd: '12px',
    paddingInline: 0,
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorSplit,
    borderRadius: 0,
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    boxShadow: 'none',
  },
  summary: {
    cursor: 'pointer',
    display: { 'default': null, '::-webkit-details-marker': 'none' },
    listStyle: 'none',
  },
  time: { fontSize: '12px', color: cssVar.colorTextTertiary },
});

const Comment = memo<{ comment: ParsedUserFeedbackComment }>(({ comment }) => (
  <Flexbox gap={2}>
    {comment.time && <span {...stylex.props(styles.time)}>{comment.time}</span>}
    <div {...stylex.props(styles.comment)}>{comment.content}</div>
  </Flexbox>
));

Comment.displayName = 'UserFeedbackComment';

const Render = memo<MarkdownElementProps>(({ children }) => {
  const text = typeof children === 'string' ? children : String(children ?? '');
  const comments = useMemo(() => parseUserFeedback(text), [text]);
  const { t } = useTranslation('chat');

  if (comments.length === 0) return null;

  const countLabel = t('userFeedbackCard.count', { count: comments.length });

  return (
    <details {...stylex.props(styles.root)}>
      <summary {...stylex.props(styles.summary)}>
        <Flexbox horizontal align={'center'} gap={12}>
          <span {...stylex.props(styles.headerIcon)}>
            <MessageSquareText size={16} />
          </span>
          <Flexbox horizontal align={'center'} flex={1} gap={8} style={{ minWidth: 0 }}>
            <Text ellipsis weight={500}>
              {t('userFeedbackCard.title')}
            </Text>
            <span {...stylex.props(styles.countBadge)}>{countLabel}</span>
          </Flexbox>
        </Flexbox>
      </summary>
      <Flexbox {...stylex.props(styles.body)} gap={12}>
        {comments.map((comment, idx) => (
          <Comment comment={comment} key={comment.id ?? idx} />
        ))}
      </Flexbox>
    </details>
  );
});

Render.displayName = 'UserFeedbackRender';

export default Render;
