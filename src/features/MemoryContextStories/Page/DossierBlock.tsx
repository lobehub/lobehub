import { type MemoryContextStoryDossier } from '@lobechat/types';
import { Button } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useState } from 'react';

import { useStoryFormat } from '../format';
import StatusMark from '../StatusMark';
import EvidenceRow from './EvidenceRow';

/** Newest records shown before "show more"; enough to tell the latest turns. */
const PREVIEW = 3;

const styles = stylex.create({
  root: {
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: '1px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    paddingBlock: '16px',
    paddingInline: '20px',
  },
  head: { display: 'flex', flexDirection: 'column', gap: '4px' },
  meta: {
    alignItems: 'center',
    color: cssVar.colorTextTertiary,
    display: 'flex',
    flexWrap: 'wrap',
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    gap: '8px',
  },
  title: { fontSize: '15px', fontWeight: 600, lineHeight: '24px', margin: 0 },
  now: { color: cssVar.colorText, fontSize: '14px', lineHeight: '22px', margin: 0 },
  list: {
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: '1px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    paddingBlockStart: '12px',
  },
  more: { alignSelf: 'flex-start', color: cssVar.colorTextSecondary, marginInlineStart: '96px' },
});

/** One dossier: where it stands, then the conversations that moved it, newest first. */
const DossierBlock = memo<{ dossier: MemoryContextStoryDossier }>(({ dossier }) => {
  const format = useStoryFormat();
  const { t } = format;
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? dossier.evidence : dossier.evidence.slice(0, PREVIEW);
  const hidden = dossier.evidence.length - shown.length;
  const span = format.span(
    dossier.firstSeenAt,
    dossier.lastEvidenceAt,
    dossier.status === 'active',
  );

  return (
    <article aria-label={dossier.title ?? undefined} {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.head)}>
        <div {...stylex.props(styles.meta)}>
          <StatusMark status={dossier.status} />
          {span && <span>{span}</span>}
          <span>·</span>
          <span>{t('story.records', { count: dossier.activityCount })}</span>
        </div>
        <h4 {...stylex.props(styles.title)}>{dossier.title || t('entity.untitled')}</h4>
        {dossier.now && <p {...stylex.props(styles.now)}>{dossier.now}</p>}
      </div>
      {shown.length > 0 && (
        <div {...stylex.props(styles.list)}>
          {shown.map((evidence) => (
            <EvidenceRow evidence={evidence} key={evidence.id} />
          ))}
          {(hidden > 0 || expanded) && dossier.evidence.length > PREVIEW && (
            <Button
              size={'small'}
              type={'text'}
              {...stylex.props(styles.more)}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded
                ? t('story.evidence.collapse')
                : t('story.evidence.showAll', { count: hidden })}
            </Button>
          )}
        </div>
      )}
    </article>
  );
});

DossierBlock.displayName = 'StoryDossierBlock';

export default DossierBlock;
