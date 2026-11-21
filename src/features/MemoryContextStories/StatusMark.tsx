import { type UserMemoryDossierStatus } from '@lobechat/types';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  root: {
    alignItems: 'center',
    color: cssVar.colorTextSecondary,
    display: 'inline-flex',
    flexShrink: 0,
    fontSize: '12px',
    gap: '6px',
    lineHeight: '18px',
  },
  dot: { borderRadius: '50%', flexShrink: 0, height: '6px', width: '6px' },
  active: { backgroundColor: cssVar.colorSuccess },
  dormant: { backgroundColor: cssVar.colorWarning },
  closed: { backgroundColor: cssVar.colorTextQuaternary },
});

/** Status as a dot plus its word, so it never relies on color alone. */
const StatusMark = memo<{ status: UserMemoryDossierStatus }>(({ status }) => {
  const { t } = useTranslation('memory');
  return (
    <span {...stylex.props(styles.root)}>
      <span aria-hidden {...stylex.props(styles.dot, styles[status])} />
      {t(`story.group.${status}`)}
    </span>
  );
});

StatusMark.displayName = 'StoryStatusMark';

export default StatusMark;
