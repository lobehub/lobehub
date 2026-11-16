import type { AcceptanceCommentItem } from '@lobechat/types';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import { AttachmentThumbs } from '../Evidence/attachments';
import { styles } from './styles';

/** The persisted words and exhibits, without a composer or mutation controls. */
const CommentContent = ({ comment }: { comment: AcceptanceCommentItem }) => {
  const { t } = useTranslation('verify');

  return (
    <>
      {comment.deletedAt ? (
        <span {...stylex.props(styles.deleted)}>{t('acceptance.comments.deleted')}</span>
      ) : (
        comment.content
      )}
      {comment.attachments.length > 0 && (
        <div {...stylex.props(styles.attachments)}>
          <AttachmentThumbs attachments={comment.attachments} size={'comment'} />
        </div>
      )}
    </>
  );
};

export default CommentContent;
