import { agentDisplayName } from '@lobechat/types';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';

import type { ProjectListItem } from '@/store/project';
import { sx } from '@/styles/sx';

import type { FolderSheet } from './folderSheet';

const styles = stylex.create({
  eyebrow: {
    color: cssVar.colorTextQuaternary,
    display: 'flex',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 10,
    gap: 8,
    justifyContent: 'space-between',
    lineHeight: 1,
  },
  headline: {
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    color: cssVar.colorText,
    display: '-webkit-box',
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: '-0.01em',
    lineHeight: 1.35,
    marginBlockEnd: 6,
    marginBlockStart: 10,
    overflow: 'hidden',
    overflowWrap: 'anywhere',
  },
  hint: {
    color: cssVar.colorTextQuaternary,
    fontSize: 11,
    lineHeight: 1.6,
    margin: 0,
  },
  placeholder: {
    backgroundColor: cssVar.colorFillTertiary,
    borderRadius: 3,
    display: 'block',
    height: 5,
  },
  placeholders: {
    display: 'grid',
    gap: 6,
    marginBlockStart: 12,
  },
  root: {
    paddingBlock: 16,
    paddingInline: 18,
  },
  row: {
    alignItems: 'center',
    color: cssVar.colorTextSecondary,
    display: 'flex',
    fontSize: 11,
    gap: 8,
    lineHeight: 1,
    paddingBlock: 5,
  },
  rowBullet: {
    backgroundColor: cssVar.colorTextQuaternary,
    borderRadius: '50%',
    flexShrink: 0,
    height: 4,
    width: 4,
  },
  rowTime: {
    color: cssVar.colorTextQuaternary,
    flexShrink: 0,
    fontSize: 10,
  },
  rowTitle: {
    flex: '1',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rule: {
    backgroundColor: cssVar.colorBorderSecondary,
    height: 1,
    marginBlockEnd: 6,
    marginBlockStart: 10,
  },
  summary: {
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    color: cssVar.colorTextSecondary,
    display: '-webkit-box',
    fontSize: 11,
    lineHeight: 1.6,
    margin: 0,
    overflow: 'hidden',
  },
});

/** Faint lines where a project's conversations will appear. */
const PLACEHOLDER_WIDTHS = ['84%', '66%', '74%'];

interface FolderPaperProps {
  project: ProjectListItem;
  sheet: FolderSheet;
}

/** The front paper: the project's latest conversations, or its brief before it has any. */
export const FolderPaper = ({ project, sheet }: FolderPaperProps) => {
  const { t } = useTranslation('project');

  if (sheet.kind === 'topics') {
    const { latest, others } = sheet;
    return (
      <div {...stylex.props(styles.root)}>
        <div {...stylex.props(styles.eyebrow)}>
          <span>{t('list.folder.recentTopic')}</span>
          <span>{dayjs(latest.updatedAt).fromNow()}</span>
        </div>
        <div {...stylex.props(styles.headline)}>
          {latest.title || t('defaultTitle', { ns: 'topic' })}
        </div>
        {latest.summary && <p {...stylex.props(styles.summary)}>{latest.summary}</p>}
        {others.length > 0 && (
          <>
            <div {...stylex.props(styles.rule)} />
            {others.map((topic) => (
              <div key={topic.id} {...stylex.props(styles.row)}>
                <i {...stylex.props(styles.rowBullet)} />
                <span {...stylex.props(styles.rowTitle)}>
                  {topic.title || t('defaultTitle', { ns: 'topic' })}
                </span>
                <span {...stylex.props(styles.rowTime)}>
                  {dayjs(topic.updatedAt).fromNow(true)}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    );
  }

  const coordinator = project.coordinatorAgent ? agentDisplayName(project.coordinatorAgent) : '';
  const lead =
    project.description ||
    (coordinator ? t('list.folder.coordinatedBy', { name: coordinator }) : project.name);

  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.eyebrow)}>
        <span>{t('list.folder.intro')}</span>
        <span>{dayjs(project.createdAt).format('YYYY.MM')}</span>
      </div>
      <div {...stylex.props(styles.headline)}>{lead}</div>
      {sheet.kind === 'intro' && (
        <p {...stylex.props(styles.hint)}>{t('list.folder.noTopicsHint')}</p>
      )}
      {sheet.kind !== 'unavailable' && (
        <div aria-hidden {...stylex.props(styles.placeholders)}>
          {PLACEHOLDER_WIDTHS.map((width) => (
            <span key={width} {...sx(styles.placeholder, { width })} />
          ))}
        </div>
      )}
    </div>
  );
};
