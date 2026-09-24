import type { AcceptanceCommentItem } from '@lobechat/types';
import { useTranslation } from 'react-i18next';

import { AttachmentThumbs } from '../Evidence/attachments';
import { styles } from './styles';

/** The persisted words and exhibits, without a composer or mutation controls. */
const CommentContent = ({ comment }: { comment: AcceptanceCommentItem }) => {
  const { t } = useTranslation('verify');

  return (
    <>
      {comment.deletedAt ? (
        <span className={styles.deleted}>{t('acceptance.comments.deleted')}</span>
      ) : (
        comment.content
      )}
      {comment.attachments.length > 0 && (
        <div className={styles.attachments}>
          <AttachmentThumbs attachments={comment.attachments} size={'comment'} />
        </div>
      )}
    </>
  );
};

export default CommentContent;
