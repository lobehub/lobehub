import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';

import { type CaseReview, fetchCaseReview, type ReviewState, type RunPayload } from '../api';
import { CATEGORY_LABELS } from '../labels';
import { hrefOf } from '../route';
import { CaseDebug } from './CaseDebug';
import { CATEGORY_TONES, Chip, type ChipTone } from './Chip';
import { ReviewEvidence } from './ReviewItemView';

const styles = stylex.create({
  back: { color: cssVar.colorTextSecondary, fontSize: 12.5 },
  file: { color: cssVar.colorTextTertiary, fontFamily: cssVar.fontFamilyCode, fontSize: 12 },
  head: {
    alignItems: 'center',
    columnGap: 10,
    display: 'flex',
    flexWrap: 'wrap',
    marginBlockEnd: 16,
    marginBlockStart: 8,
    rowGap: 6,
  },
  link: { fontSize: 13, marginInlineStart: 'auto' },
  muted: { color: cssVar.colorTextSecondary, fontSize: 13 },
  rework: {
    color: cssVar.colorTextSecondary,
    fontSize: 14,
    lineHeight: 1.6,
    marginBlockEnd: 16,
    maxWidth: 760,
  },
  section: { maxWidth: 1400 },
  title: { fontSize: 20, fontWeight: 600, marginBlock: 0 },
});

const STATES: Record<ReviewState, { label: string; tone: ChipTone }> = {
  'changed': { label: '改过了，待重看', tone: 'warn' },
  'passed': { label: '已通过', tone: 'ok' },
  'reworked': { label: '已打回', tone: 'bad' },
  'todo': { label: '待看', tone: 'warn' },
  'waiting-agent': { label: '等 agent', tone: 'plain' },
};

const stateChip = ({ item, queued }: CaseReview) =>
  queued ? STATES[item.state] : { label: '工具已证明，不用人工看', tone: 'ok' as const };

const useCaseReview = (caseKey: string) => {
  const [loaded, setLoaded] = useState<{ error?: string; key: string; review?: CaseReview }>();
  useEffect(() => {
    let current = true;
    fetchCaseReview(caseKey)
      .then((review) => current && setLoaded({ key: caseKey, review }))
      .catch((reason: unknown) => current && setLoaded({ error: String(reason), key: caseKey }));
    return () => {
      current = false;
    };
  }, [caseKey]);
  return loaded?.key === caseKey ? loaded : undefined;
};

export const CaseView = ({ caseKey, payload }: { caseKey: string; payload: RunPayload }) => {
  const loaded = useCaseReview(caseKey);
  const review = loaded?.review;
  const file = review?.item.file ?? caseKey.slice(0, caseKey.indexOf('|'));
  const state = review && stateChip(review);
  return (
    <section {...stylex.props(styles.section)}>
      <a href={hrefOf({ file, kind: 'file' })} {...stylex.props(styles.back)}>
        ← {file}
      </a>
      {loaded?.error && <div {...stylex.props(styles.muted)}>读取用例失败：{loaded.error}</div>}
      {!loaded && <div {...stylex.props(styles.muted)}>正在读取用例…</div>}
      {review && state && (
        <>
          <div {...stylex.props(styles.head)}>
            <h1 {...stylex.props(styles.title)}>{review.item.title}</h1>
            <Chip tone={CATEGORY_TONES[review.item.category] ?? 'plain'}>
              {CATEGORY_LABELS[review.item.category] ?? review.item.category}
            </Chip>
            {review.item.component && <Chip tone="info">{review.item.component}</Chip>}
            <Chip tone={state.tone}>{state.label}</Chip>
            <span {...stylex.props(styles.file)}>{review.item.file}</span>
            {review.queued && (
              <a href={hrefOf({ key: caseKey, kind: 'review' })} {...stylex.props(styles.link)}>
                在审阅里打开 →
              </a>
            )}
          </div>
          {review.item.rework && (
            <p {...stylex.props(styles.rework)}>打回原因：{review.item.rework.note}</p>
          )}
          <ReviewEvidence conditions={review.conditions} item={review.item} notes="written" />
        </>
      )}
      <CaseDebug caseKey={caseKey} payload={payload} />
    </section>
  );
};
