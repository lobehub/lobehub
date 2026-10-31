'use client';

import type { WidgetManifest, WidgetOutput, WidgetView } from '@lobechat/types';
import { Button, Flexbox, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import type { DashboardWidgetDetail } from '@/services/dashboard';

import WidgetCard from '../WidgetCard';
import { toPreviewWidget, toSampleWidget } from './previewWidget';

export const reviewStyles = stylex.create({
  label: {
    color: cssVar.colorTextTertiary,
    flex: 'none',
    width: '88px',
  },
  section: {
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
    borderRadius: cssVar.borderRadius,
    padding: '10px',
  },
});

/**
 * A titled block of the review: the card a version produces leads, the facts
 * and the script follow.
 */
export const ReviewSection = ({
  children,
  note,
  title,
}: {
  children: ReactNode;
  /** Where the block's content comes from, read beside the title. */
  note?: ReactNode;
  title: ReactNode;
}) => (
  <Flexbox gap={6}>
    <Flexbox horizontal align={'baseline'} gap={6} wrap={'wrap'}>
      <Text fontSize={12} type={'secondary'} weight={500}>
        {title}
      </Text>
      {note && (
        <Text fontSize={12} type={'secondary'}>
          {'· '}
          {note}
        </Text>
      )}
    </Flexbox>
    {children}
  </Flexbox>
);

/**
 * Approvers judge a widget by the card it puts on their dashboard, not by its
 * code, so the script sits folded under its heading until asked for.
 */
export const FoldedSection = ({ children, title }: { children: ReactNode; title: ReactNode }) => {
  const [open, setOpen] = useState(false);

  return (
    <Flexbox gap={6}>
      <Button
        data-review-fold
        aria-expanded={open}
        icon={open ? ChevronDownIcon : ChevronRightIcon}
        size={'small'}
        style={{ alignSelf: 'flex-start', paddingInline: 4 }}
        type={'text'}
        onClick={() => setOpen((value) => !value)}
      >
        <Text fontSize={12} type={'secondary'} weight={500}>
          {title}
        </Text>
      </Button>
      {open && children}
    </Flexbox>
  );
};

type PreviewRun = Parameters<typeof toPreviewWidget>[1];

/** The dashboard card a run produces, at the size it takes on a board. */
export const ReviewPreviewCard = ({
  run,
  view,
  widget,
}: {
  run: PreviewRun;
  view?: WidgetView | null;
  widget: DashboardWidgetDetail;
}) => (
  <div data-review-preview-card style={{ height: run.output?.type === 'stat' ? 150 : 240 }}>
    <WidgetCard view={view} widget={toPreviewWidget(widget, run)} />
  </div>
);

/**
 * The card a version that never ran would make, filled with sample values
 * and tagged as such in its title so nobody reads them as data.
 */
export const ReviewSampleCard = ({
  output,
  view,
  widget,
}: {
  output: WidgetOutput;
  view?: WidgetView | null;
  widget: DashboardWidgetDetail;
}) => {
  const { t } = useTranslation('dashboard');
  return (
    <div data-review-sample-card style={{ height: output.type === 'stat' ? 150 : 240 }}>
      <WidgetCard
        view={view}
        widget={toSampleWidget(widget, output)}
        title={
          <Flexbox horizontal align={'center'} gap={6} style={{ flex: 1, minWidth: 0 }}>
            <Text ellipsis weight={500}>
              {widget.title}
            </Text>
            <Tag size={'small'}>{t('review.sampleTag')}</Tag>
          </Flexbox>
        }
      />
    </div>
  );
};

export const Fact = ({ label, children }: { children: ReactNode; label: string }) => (
  <Flexbox horizontal align={'baseline'} gap={8}>
    <Text className={stylex.props(reviewStyles.label).className} fontSize={12}>
      {label}
    </Text>
    <Flexbox horizontal flex={1} gap={4} style={{ minWidth: 0 }} wrap={'wrap'}>
      {children}
    </Flexbox>
  </Flexbox>
);

/** What a version may touch when it runs: the hosts it can reach and the credentials it gets. */
export const AccessFacts = memo<{ manifest?: WidgetManifest | null }>(({ manifest }) => {
  const { t } = useTranslation('dashboard');
  const hosts = manifest?.network?.allow ?? [];
  const env = manifest?.env ?? [];

  return (
    <>
      <Fact label={t('publish.network')}>
        {hosts.length > 0 ? (
          hosts.map((host) => (
            <Tag key={host} size={'small'}>
              {host}
            </Tag>
          ))
        ) : (
          <Text fontSize={12}>{t('publish.networkNone')}</Text>
        )}
      </Fact>
      <Fact label={t('publish.env')}>
        {env.length > 0 ? (
          env.map((item) => (
            <Tag key={item.name} size={'small'}>
              {[item.connector ? `${item.name} ← ${item.connector}` : item.name, item.field]
                .filter(Boolean)
                .join(' · ')}
            </Tag>
          ))
        ) : (
          <Text fontSize={12}>{t('publish.envNone')}</Text>
        )}
      </Fact>
    </>
  );
});

AccessFacts.displayName = 'DashboardReviewAccessFacts';

/**
 * The review could not be shown — a request failed, or the version under
 * review is gone. Approval stays held, so say so and offer a retry.
 */
export const ReviewUnavailable = memo<{
  error?: unknown;
  missing?: boolean;
  onRetry: () => void;
}>(({ error, missing, onRetry }) => {
  const { t } = useTranslation('dashboard');
  return (
    <AsyncError
      description={missing ? t('review.versionMissing') : undefined}
      error={error}
      title={t('review.loadFailed')}
      variant={'block'}
      onRetry={onRetry}
    />
  );
});

ReviewUnavailable.displayName = 'DashboardReviewUnavailable';
