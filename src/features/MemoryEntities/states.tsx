import { Button, Empty, Skeleton, SkeletonAvatar, SkeletonText } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CloudOffIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import MemoryAnalysis from '@/routes/(main)/memory/features/MemoryAnalysis';
import { useInterfaceDensity } from '@/styles/density';
import { densityTokens } from '@/styles/density.stylex';

import KindIcon from './components/KindIcon';
import { useEntityFormat } from './format';
import { CONTEXT_KINDS } from './kinds';

const styles = stylex.create({
  center: {
    alignItems: 'center',
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    gap: '32px',
    justifyContent: 'center',
    // A flex item grows to its widest line by default; let it shrink to a phone.
    minWidth: 0,
    paddingBlock: '48px',
    paddingInline: '24px',
  },
  intro: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxWidth: '440px',
    textAlign: 'center',
  },
  title: { fontSize: '20px', fontWeight: 600, margin: 0 },
  desc: {
    color: cssVar.colorTextSecondary,
    fontSize: densityTokens['--lobe-density-font-size'],
    lineHeight: '22px',
    margin: 0,
  },
  analysis: { maxWidth: '320px', width: '100%' },
  kinds: {
    display: 'grid',
    gap: '8px',
    // `min()` lets a phone fall back to one column instead of overflowing.
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))',
    maxWidth: '600px',
    width: '100%',
  },
  kind: {
    alignItems: 'center',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: '1px',
    display: 'flex',
    gap: densityTokens['--lobe-density-content-gap'],
    paddingBlock: densityTokens['--lobe-density-content-gap'],
    paddingInline: densityTokens['--lobe-density-content-gap'],
  },
  kindText: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  kindLabel: { fontSize: '13px', fontWeight: 500 },
  kindExample: { color: cssVar.colorTextTertiary, fontSize: '12px' },
  loading: { display: 'flex', flex: '1', height: '100%' },
  loadingList: {
    borderInlineEndColor: cssVar.colorBorderSecondary,
    borderInlineEndStyle: 'solid',
    borderInlineEndWidth: '1px',
    display: 'flex',
    flexDirection: 'column',
    gap: densityTokens['--lobe-density-section-gap'],
    paddingBlock: '20px',
    paddingInline: densityTokens['--lobe-density-card-padding'],
    width: '320px',
  },
  // Compact entity rows are 4px shorter (6px block padding), so the skeleton pitch follows.
  loadingListCompact: { gap: '12px' },
  loadingRow: {
    alignItems: 'flex-start',
    display: 'flex',
    gap: densityTokens['--lobe-density-content-gap'],
  },
  loadingPage: {
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    gap: '40px',
    marginInline: 'auto',
    maxWidth: '720px',
    paddingBlock: '40px',
    paddingInline: '48px',
  },
});

/** First run: say what this page will hold, with one example per kind, and how to fill it. */
export const FirstRunState = memo(() => {
  const format = useEntityFormat();
  return (
    <div {...stylex.props(styles.center)}>
      <div {...stylex.props(styles.intro)}>
        <h2 {...stylex.props(styles.title)}>{format.t('entity.firstRun.title')}</h2>
        <p {...stylex.props(styles.desc)}>{format.t('entity.firstRun.desc')}</p>
      </div>
      <div {...stylex.props(styles.kinds)}>
        {CONTEXT_KINDS.map((kind) => (
          <div key={kind} {...stylex.props(styles.kind)}>
            <KindIcon kind={kind} />
            <span {...stylex.props(styles.kindText)}>
              <span {...stylex.props(styles.kindLabel)}>{format.kind(kind)}</span>
              <span {...stylex.props(styles.kindExample)}>{format.kindExample(kind)}</span>
            </span>
          </div>
        ))}
      </div>
      <div {...stylex.props(styles.analysis)}>
        <MemoryAnalysis />
      </div>
    </div>
  );
});

FirstRunState.displayName = 'FirstRunState';

export const ErrorState = memo<{ onRetry: () => void }>(({ onRetry }) => {
  const { t } = useTranslation('memory');
  return (
    <div {...stylex.props(styles.center)}>
      <Empty
        description={t('entity.error.desc')}
        icon={CloudOffIcon}
        title={t('entity.error.title')}
        action={
          <Button type={'primary'} onClick={onRetry}>
            {t('entity.error.retry')}
          </Button>
        }
      />
    </div>
  );
});

ErrorState.displayName = 'ErrorState';

/** Same frame as the loaded page, so nothing jumps when data arrives. */
export const LoadingState = memo(() => {
  const compact = useInterfaceDensity() === 'compact';

  return (
    <div aria-busy {...stylex.props(styles.loading)}>
      <div {...stylex.props(styles.loadingList, compact && styles.loadingListCompact)}>
        <Skeleton height={22} width={64} />
        <Skeleton height={32} radius={8} width={'100%'} />
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} {...stylex.props(styles.loadingRow)}>
            <SkeletonAvatar shape={'square'} size={24} />
            <SkeletonText fontSize={12} rows={2} width={['60%', '90%']} />
          </div>
        ))}
      </div>
      <div {...stylex.props(styles.loadingPage)}>
        <div {...stylex.props(styles.loadingRow)}>
          <SkeletonAvatar shape={'square'} size={40} />
          <SkeletonText fontSize={20} rows={2} width={['40%', '25%']} />
        </div>
        <SkeletonText fontSize={17} rows={3} width={['15%', '100%', '70%']} />
        <SkeletonText rows={6} width={['15%', '90%', '60%', '95%', '80%', '50%']} />
      </div>
    </div>
  );
});

LoadingState.displayName = 'LoadingState';
