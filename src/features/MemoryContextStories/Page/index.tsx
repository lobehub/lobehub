import { type MemoryContextStory } from '@lobechat/types';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo } from 'react';

import Section from '@/features/MemoryEntities/EntityPage/Section';

import { splitDossiers } from '../derive';
import { useStoryFormat } from '../format';
import StatusMark from '../StatusMark';
import DossierBlock from './DossierBlock';
import EvidenceRow from './EvidenceRow';

const styles = stylex.create({
  scroll: { flex: '1', height: '100%', minWidth: 0, overflowY: 'auto' },
  column: {
    display: 'flex',
    flexDirection: 'column',
    gap: '36px',
    marginInline: 'auto',
    maxWidth: '760px',
    paddingBlockEnd: '96px',
    paddingBlockStart: '40px',
    paddingInline: '48px',
  },
  header: { display: 'flex', flexDirection: 'column', gap: '12px' },
  eyebrow: {
    alignItems: 'center',
    color: cssVar.colorTextTertiary,
    display: 'flex',
    flexWrap: 'wrap',
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    gap: '8px',
  },
  title: { fontSize: '24px', fontWeight: 600, lineHeight: '32px', margin: 0 },
  now: { color: cssVar.colorText, fontSize: '17px', lineHeight: '28px', margin: 0 },
  placeholder: { color: cssVar.colorTextTertiary, fontSize: '14px' },
  pair: {
    display: 'grid',
    gap: '24px',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    fontSize: '14px',
    gap: '6px',
    lineHeight: '22px',
    margin: 0,
    paddingInlineStart: '20px',
  },
  dossiers: { display: 'flex', flexDirection: 'column', gap: '12px' },
  scattered: { display: 'flex', flexDirection: 'column', gap: '16px' },
  generated: { color: cssVar.colorTextQuaternary, fontSize: '12px' },
});

interface StoryPageProps {
  story: MemoryContextStory;
}

/**
 * One context read top to bottom in decision order: where it stands → what is next and still
 * open → the dossiers that got it here → the one-off progress.
 */
const StoryPage = memo<StoryPageProps>(({ story }) => {
  const format = useStoryFormat();
  const { t } = format;
  const nextSteps = story.nextSteps ?? [];
  const openQuestions = story.openQuestions ?? [];
  const { dossiers, scattered } = useMemo(
    () => splitDossiers(story.dossiers ?? []),
    [story.dossiers],
  );
  const scatteredEvidence = useMemo(
    () =>
      scattered
        .flatMap((d) => d.evidence ?? [])
        .sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime()),
    [scattered],
  );
  const span = format.span(story.firstSeenAt, story.lastEvidenceAt, story.status === 'active');
  const title = story.title || t('entity.untitled');

  return (
    // Keyed by story so opening another one starts at the top.
    <main aria-label={title} key={story.id} {...stylex.props(styles.scroll)}>
      <div {...stylex.props(styles.column)}>
        <header {...stylex.props(styles.header)}>
          <div {...stylex.props(styles.eyebrow)}>
            <StatusMark status={story.status} />
            {span && <span>{span}</span>}
            <span>·</span>
            <span>
              {t('story.card.meta', {
                dossiers: story.dossierCount,
                evidence: story.evidenceCount,
              })}
            </span>
          </div>
          <h1 {...stylex.props(styles.title)}>{title}</h1>
        </header>

        <Section title={t('story.now')}>
          <p {...stylex.props(styles.now, !story.now && styles.placeholder)}>
            {story.now || t('story.now.empty')}
          </p>
        </Section>

        {(nextSteps.length > 0 || openQuestions.length > 0) && (
          <div {...stylex.props(styles.pair)}>
            {nextSteps.length > 0 && (
              <Section title={t('story.next')}>
                <ul {...stylex.props(styles.list)}>
                  {nextSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              </Section>
            )}
            {openQuestions.length > 0 && (
              <Section title={t('story.openQuestions')}>
                <ul {...stylex.props(styles.list)}>
                  {openQuestions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              </Section>
            )}
          </div>
        )}

        {dossiers.length > 0 && (
          <Section
            extra={t('story.dossiers.extra', { count: dossiers.length })}
            title={t('story.dossiers')}
          >
            <div {...stylex.props(styles.dossiers)}>
              {dossiers.map((dossier) => (
                <DossierBlock dossier={dossier} key={dossier.id} />
              ))}
            </div>
          </Section>
        )}

        {scatteredEvidence.length > 0 && (
          <Section extra={t('story.scattered.extra')} title={t('story.scattered')}>
            <div {...stylex.props(styles.scattered)}>
              {scatteredEvidence.map((evidence) => (
                <EvidenceRow evidence={evidence} key={evidence.id} />
              ))}
            </div>
          </Section>
        )}

        <span {...stylex.props(styles.generated)}>
          {t('story.generated', { count: story.evidenceCount })}
        </span>
      </div>
    </main>
  );
});

StoryPage.displayName = 'StoryPage';

export default StoryPage;
