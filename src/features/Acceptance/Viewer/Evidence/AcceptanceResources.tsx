'use client';

import { isDraftVerifyRun } from '@lobechat/const/verify';
import { Button, Select } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { Paperclip } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsHydrated } from '@/hooks/useIsHydrated';

import { useAcceptanceScope } from '../AcceptanceScope';
import QuietState from '../QuietState';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import { useAcceptanceTurn } from '../useAcceptanceTurn';
import {
  collectResources,
  countResources,
  filterResources,
  RESOURCE_FILTERS,
  type ResourceFilter,
  type ResourceItem,
} from './resources';
import ResourceTile from './ResourceTile';

const narrow = '@container (width < 720px)';
const single = '@container (width < 440px)';

const styles = stylex.create({
  root: { containerType: 'inline-size', display: 'flex', flexDirection: 'column', gap: '16px' },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    alignItems: 'center',
    minHeight: '28px',
  },
  filters: { display: 'flex', flex: '1', gap: '4px', alignItems: 'center', minWidth: 0 },
  filter: {
    cursor: 'pointer',
    display: 'inline-flex',
    gap: '8px',
    alignItems: 'center',
    height: '28px',
    margin: '0',
    paddingBlock: 0,
    paddingInline: '12px',
    borderWidth: 0,
    borderStyle: 'none',
    borderColor: 'currentcolor',
    borderRadius: '6px',
    font: 'inherit',
    fontSize: '12px',
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
    whiteSpace: 'nowrap',
    appearance: 'none',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '2px' },
  },
  filterOn: {
    fontWeight: 500,
    color: cssVar.colorText,
    backgroundColor: { 'default': cssVar.colorFillSecondary, ':hover': cssVar.colorFillSecondary },
  },
  filterCount: { fontWeight: 400, color: cssVar.colorTextTertiary },
  roundSelect: { width: '128px' },
  grid: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'repeat(3, minmax(0, 1fr))',
      [narrow]: 'repeat(2, minmax(0, 1fr))',
      [single]: 'minmax(0, 1fr)',
    },
    gap: '16px',
  },
});

const FILTER_LABEL_KEY = {
  all: 'acceptance.resources.filter.all',
  other: 'acceptance.resources.filter.other',
  recording: 'acceptance.resources.filter.recording',
  screenshot: 'acceptance.resources.filter.screenshot',
} as const satisfies Record<ResourceFilter, string>;

const AcceptanceResources = () => {
  const { t } = useTranslation('verify');
  const hydrated = useIsHydrated();
  const { acceptanceId, embedded } = useAcceptanceScope();
  const { setTurn, turn } = useAcceptanceTurn(embedded);
  const { data } = useAcceptanceBundle(acceptanceId);
  const [kind, setKind] = useState<ResourceFilter>('all');
  if (!data) return null;

  const rounds = data.rounds ?? [];
  const all = collectResources(data.checks ?? []);
  if (all.length === 0)
    return (
      <QuietState
        description={t('acceptance.resources.emptyDescription')}
        icon={Paperclip}
        title={t('acceptance.resources.emptyTitle')}
      />
    );

  const counts = countResources(filterResources(all, { kind: 'all', round: turn }));
  const visible = filterResources(all, { kind, round: turn });

  const detailOf = (item: ResourceItem) =>
    [
      `C${item.checkSeq}`,
      item.roundIndex === null ? null : t('acceptance.round', { round: item.roundIndex }),
      hydrated && item.evidence.capturedAt
        ? dayjs(item.evidence.capturedAt).format('MM-DD HH:mm')
        : null,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.toolbar)}>
        <div
          aria-label={t('acceptance.resources.filterLabel')}
          role={'group'}
          {...stylex.props(styles.filters)}
        >
          {RESOURCE_FILTERS.map((filter) => (
            <button
              aria-pressed={kind === filter}
              key={filter}
              type={'button'}
              {...stylex.props(styles.filter, kind === filter && styles.filterOn)}
              onClick={() => setKind(filter)}
            >
              {t(FILTER_LABEL_KEY[filter])}
              <span {...stylex.props(styles.filterCount)}>{counts[filter]}</span>
            </button>
          ))}
        </div>
        {rounds.length > 1 && (
          <Select
            aria-label={t('acceptance.resources.roundLabel')}
            className={stylex.props(styles.roundSelect).className}
            value={turn === null ? 'all' : String(turn)}
            variant={'filled'}
            options={[
              { label: t('acceptance.filter.roundAll'), value: 'all' },
              ...[...rounds].reverse().map((round) => ({
                label: isDraftVerifyRun(round.run)
                  ? t('flow.pendingPlan')
                  : t('acceptance.round', { round: round.run.roundIndex }),
                value: String(round.run.roundIndex),
              })),
            ]}
            onChange={(value) => setTurn(value === 'all' ? null : Number(value))}
          />
        )}
      </div>
      {visible.length === 0 ? (
        <QuietState
          icon={Paperclip}
          title={t('acceptance.resources.noMatch')}
          action={
            <Button
              onClick={() => {
                setKind('all');
                if (turn !== null) setTurn(null);
              }}
            >
              {t('acceptance.resources.showAll', { count: all.length })}
            </Button>
          }
        />
      ) : (
        <div {...stylex.props(styles.grid)}>
          {visible.map((item) => (
            <ResourceTile detail={detailOf(item)} item={item} key={item.key} />
          ))}
        </div>
      )}
    </div>
  );
};

export default AcceptanceResources;
