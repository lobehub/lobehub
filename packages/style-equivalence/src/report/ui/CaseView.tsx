import { Button, Flexbox } from '@lobehub/ui';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';

import { type CaseReview, fetchCaseReview, type ReviewState, type RunPayload } from '../api';
import { hrefOf } from '../route';
import { CaseDebug } from './CaseDebug';
import { Chip, type ChipTone } from './Chip';
import { InlineState } from './PageState';
import { ReviewEvidence } from './ReviewEvidence';
import { ItemHeader, ReworkNote } from './ReviewItemView';

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
    <Flexbox gap={24} style={{ maxWidth: 1440 }}>
      <Flexbox gap={12}>
        <Flexbox horizontal>
          <Button href={hrefOf({ file, kind: 'file' })} icon={ArrowLeft} size="small" type="text">
            {file}
          </Button>
        </Flexbox>
        {!review && (
          <InlineState
            error={loaded?.error && `读取用例失败：${loaded.error}`}
            loading="正在读取用例…"
          />
        )}
        {review && state && (
          <ItemHeader
            extra={<Chip tone={state.tone}>{state.label}</Chip>}
            item={review.item}
            action={
              review.queued && (
                <Button
                  href={hrefOf({ key: caseKey, kind: 'review' })}
                  icon={ArrowRight}
                  iconPosition="end"
                  size="small"
                >
                  在复查里打开
                </Button>
              )
            }
          />
        )}
        {review?.item.rework && <ReworkNote note={review.item.rework.note} />}
      </Flexbox>
      {review && (
        <ReviewEvidence conditions={review.conditions} item={review.item} notes="written" />
      )}
      <CaseDebug caseKey={caseKey} payload={payload} />
    </Flexbox>
  );
};
