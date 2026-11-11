'use client';

import { Button, Flexbox, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import type { TFunction } from 'i18next';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatPercent } from '@/features/DeviceManager/DeviceHealth/format';
import { agentQuotaSelectors, type QuotaAccount, useAgentQuotaStore } from '@/store/agentQuota';

import { accountDisplayName, providerAvatar } from './AccountRow';
import {
  type AccountView,
  type AccountWindowKey,
  deriveAccountView,
  type SubscriptionProvider,
} from './accountView';
import {
  accountWindows,
  axisMidnights,
  buildQuotaAxis,
  isUsableAt,
  type QuotaAxis,
  type QuotaWindow,
  resetDayOf,
  summarizeQuota,
  teamBuckets,
  WINDOW_MS,
} from './quotaWindows';

dayjs.extend(relativeTime);

type ProviderAccount = QuotaAccount & { provider: SubscriptionProvider };

/** Windows move with the clock; a minute is finer than any change the grid shows. */
const TICK_MS = 60_000;
/**
 * Teammates spend the accounts while the calendar sits open, and the Team tab
 * has no refresh button: re-read every account's readings on the same beat.
 */
const READINGS_REFRESH_MS = 60_000;

/** Every 5-hour window is one square of this size, plus the gap before the next. */
// Cells are 26px squares (keep in sync with styles.cell).
const STEP_PX = 28;
const PX_PER_MS = STEP_PX / WINDOW_MS;
const x = (at: number, axis: QuotaAxis) => `${Math.round((at - axis.start) * PX_PER_MS)}px`;

const HATCH = (color: string) =>
  `repeating-linear-gradient(-45deg, ${color} 0 3px, color-mix(in srgb, ${color} 35%, transparent) 3px 6px)`;
/** Blue deepens with how much of the window is spent. */
const usedColor = (percent: number) =>
  `color-mix(in srgb, ${cssVar.colorInfo} ${Math.round(35 + Math.min(percent, 100) * 0.5)}%, transparent)`;

const styles = stylex.create({
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    paddingBlock: '16px',
    paddingInline: '16px',
    backgroundColor: cssVar.colorBgContainer,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '12px',
  },
  // The whole grid scrolls sideways; windows keep their size instead of squeezing.
  scroller: { overflowX: 'auto', overflowY: 'hidden', paddingBlockEnd: '4px' },
  row: {
    display: 'flex',
    alignItems: 'center',
    width: 'max-content',
    minWidth: '100%',
    paddingBlock: '3px',
    borderRadius: cssVar.borderRadius,
  },
  rowClickable: {
    cursor: 'pointer',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    outline: { 'default': 'none', ':focus-visible': `2px solid ${cssVar.colorPrimary}` },
  },
  rowActive: { backgroundColor: cssVar.colorFillSecondary },
  rowDisabled: { opacity: 0.55 },
  // Name and reset times stay put while the windows scroll under them.
  lead: {
    position: 'sticky',
    insetInlineStart: 0,
    zIndex: 1,
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
    alignSelf: 'stretch',
    paddingInline: '8px',
    backgroundColor: cssVar.colorBgContainer,
  },
  // Paints the row's hover / active fill over the opaque lead.
  leadHover: {
    backgroundImage: {
      default: 'none',
      [stylex.when.ancestor(':hover')]:
        `linear-gradient(${cssVar.colorFillTertiary}, ${cssVar.colorFillTertiary})`,
    },
  },
  leadActive: {
    backgroundImage: `linear-gradient(${cssVar.colorFillSecondary}, ${cssVar.colorFillSecondary})`,
  },
  name: { display: 'flex', alignItems: 'center', gap: '8px', width: '160px', minWidth: 0 },
  // A narrow screen drops the reset times; the windows and their tooltips carry them.
  resets: {
    display: { 'default': 'flex', '@media (max-width: 1100px)': 'none' },
    flexDirection: 'column',
    justifyContent: 'center',
    gap: '2px',
    width: '164px',
    minHeight: '40px',
    paddingInlineStart: '8px',
  },
  track: (width: string) => ({
    position: 'relative',
    flexShrink: 0,
    width,
    height: '34px',
    marginInlineEnd: '8px',
  }),
  dayLine: (left: string) => ({
    position: 'absolute',
    insetBlock: 0,
    insetInlineStart: left,
    width: '1px',
    backgroundColor: cssVar.colorBorderSecondary,
  }),
  nowLine: (left: string) => ({
    position: 'absolute',
    insetBlock: 0,
    insetInlineStart: left,
    width: '2px',
    borderRadius: '1px',
    backgroundColor: cssVar.colorPrimary,
    zIndex: 1,
  }),
  dayLabel: (left: string) => ({
    position: 'absolute',
    insetBlockStart: '8px',
    insetInlineStart: left,
    paddingInlineStart: '4px',
    whiteSpace: 'nowrap',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
  }),
  cell: (left: string, color: string, image: string) => ({
    position: 'absolute',
    insetBlockStart: '4px',
    insetInlineStart: left,
    width: '26px',
    height: '26px',
    borderRadius: '5px',
    backgroundColor: color,
    backgroundImage: image,
  }),
  count: (color: string) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '11px',
    fontVariantNumeric: 'tabular-nums',
    color,
  }),
  // Nearly used up: a small dot on the window's corner.
  dot: {
    position: 'absolute',
    insetBlockStart: '-3px',
    insetInlineEnd: '-3px',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: cssVar.colorWarning,
    boxShadow: `0 0 0 2px ${cssVar.colorBgContainer}`,
  },
  note: (left: string) => ({
    position: 'absolute',
    insetBlockStart: '9px',
    insetInlineStart: left,
    paddingInlineStart: '8px',
    whiteSpace: 'nowrap',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  }),
  // A failed read: what went wrong, and a way to try again.
  failure: (left: string) => ({
    position: 'absolute',
    insetBlockStart: '4px',
    insetInlineStart: left,
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    paddingInlineStart: '8px',
    whiteSpace: 'nowrap',
    fontSize: '12px',
    color: cssVar.colorError,
  }),
  swatch: { position: 'relative', width: '14px', height: '14px', borderRadius: '4px' },
});

/** Re-render every minute, so windows move on and resets come due. */
const useNow = () => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);
  return now;
};

const dayName = (at: number, now: number, t: TFunction<'setting'>) => {
  switch (resetDayOf(at, now)) {
    case 'today': {
      return t('subscriptionAccounts.calendar.todayDay');
    }
    case 'tomorrow': {
      return t('subscriptionAccounts.calendar.tomorrowDay');
    }
    default: {
      return dayjs(at).format('ddd');
    }
  }
};

/** `Today 14:20` / `Tomorrow 09:00` / `Fri 09:00`: the day matters more than the date within a week. */
const formatTime = (at: number, now: number, t: TFunction<'setting'>) => {
  const day = resetDayOf(at, now);
  const time = dayjs(at).format('HH:mm');
  if (day === 'today') return t('subscriptionAccounts.calendar.today', { time });
  if (day === 'tomorrow') return t('subscriptionAccounts.calendar.tomorrow', { time });
  return dayjs(at).format('ddd HH:mm');
};

/** `Today 12:06–17:06`, naming the end's day too when the window crosses midnight. */
const formatRange = (start: number, end: number, now: number, t: TFunction<'setting'>) =>
  dayjs(start).isSame(end, 'day')
    ? `${formatTime(start, now, t)}–${dayjs(end).format('HH:mm')}`
    : `${formatTime(start, now, t)}–${formatTime(end, now, t)}`;

const windowLabel = (key: AccountWindowKey | undefined, t: TFunction<'setting'>) =>
  key === 'weekly'
    ? t('subscriptionAccounts.meter.weekly')
    : t('subscriptionAccounts.meter.session');

const windowStyle = (window: QuotaWindow, left: string) => {
  switch (window.state) {
    case 'blocked': {
      return styles.cell(left, 'transparent', HATCH(cssVar.colorError));
    }
    case 'used': {
      return styles.cell(left, usedColor(window.usedPercent ?? 0), 'none');
    }
    default: {
      return styles.cell(left, cssVar.colorFillSecondary, 'none');
    }
  }
};

const windowText = (window: QuotaWindow, now: number, t: TFunction<'setting'>) => {
  const limit = window.blockedBy ?? window.tightBy;
  const values = {
    percent: formatPercent(limit?.usedPercent),
    // An unreported reset is only known as a bound: say "by" rather than "at".
    time: limit
      ? limit.estimated
        ? t('subscriptionAccounts.calendar.latest', { time: formatTime(limit.until, now, t) })
        : formatTime(limit.until, now, t)
      : '',
    window: windowLabel(limit?.key, t),
  };
  const state =
    window.state === 'blocked'
      ? t('subscriptionAccounts.calendar.state.blocked', values)
      : window.state === 'used'
        ? t('subscriptionAccounts.calendar.state.used', {
            percent: formatPercent(window.usedPercent),
          })
        : t('subscriptionAccounts.calendar.state.idle');
  return window.tightBy
    ? `${state} · ${t('subscriptionAccounts.calendar.state.tight', values)}`
    : state;
};

interface RowProps {
  account: ProviderAccount;
  active?: boolean;
  axis: QuotaAxis;
  loaded: boolean;
  now: number;
  onOpen?: () => void;
  trackWidth: string;
  view: AccountView;
  windows: QuotaWindow[];
}

const DayLines = ({ axis, midnights }: { axis: QuotaAxis; midnights: number[] }) => (
  <>
    {midnights.map((at) => (
      <span aria-hidden key={at} {...stylex.props(styles.dayLine(x(at, axis)))} />
    ))}
  </>
);

const AccountWindowsRow = ({
  account,
  active,
  axis,
  loaded,
  now,
  onOpen,
  trackWidth,
  view,
  windows,
}: RowProps) => {
  const { t } = useTranslation('setting');
  const useFetchQuotaReadings = useAgentQuotaStore((s) => s.useFetchQuotaReadings);
  const { isValidating, revalidate } = useFetchQuotaReadings(account.id, {
    refreshInterval: READINGS_REFRESH_MS,
  });
  // A read that failed with nothing to show must not look like one still loading.
  const failed = useAgentQuotaStore(agentQuotaSelectors.readingsFailed(account.id)) && !loaded;
  const name = accountDisplayName(account);
  const midnights = axisMidnights(axis);

  const resets = (['session', 'weekly'] as const).flatMap((key) => {
    const window = view[key];
    const at = window?.resetsAt ?? window?.latestResetAt;
    if (!window || at == null || at <= now) return [];
    return [
      {
        estimated: window.resetsAt == null,
        exhausted: window.usedPercent >= 100,
        key,
        resetsAt: at,
      },
    ];
  });
  // Before the readings arrive the row says nothing rather than "no data".
  const idleText = failed
    ? t('subscriptionAccounts.calendar.failed')
    : !loaded
      ? '—'
      : view.status === 'noData'
        ? t('subscriptionAccounts.status.noData')
        : t('subscriptionAccounts.calendar.idle');
  // Out of rotation or never reported: there are no windows to draw, only why.
  // A failed read says so instead; the two notes would overlap.
  const note = failed
    ? undefined
    : view.status === 'disabled'
      ? t('subscriptionAccounts.status.disabled')
      : view.status === 'noData' && loaded
        ? t('subscriptionAccounts.status.noData')
        : undefined;
  const drawWindows = loaded && !note;

  const clickable = onOpen
    ? {
        'aria-current': active || undefined,
        'onClick': onOpen,
        'onKeyDown': (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' && e.target === e.currentTarget) {
            e.preventDefault();
            onOpen();
          }
        },
        'role': 'button',
        'tabIndex': 0,
      }
    : { role: 'group' };

  return (
    <div
      {...stylex.props(
        styles.row,
        stylex.defaultMarker(),
        onOpen && styles.rowClickable,
        active && styles.rowActive,
        view.status === 'disabled' && styles.rowDisabled,
      )}
      aria-label={name}
      data-account-row={account.id}
      {...clickable}
    >
      <div {...stylex.props(styles.lead, onOpen && styles.leadHover, active && styles.leadActive)}>
        <div {...stylex.props(styles.name)}>
          <span style={{ display: 'flex', flex: 'none' }}>
            {providerAvatar(account.provider, 20)}
          </span>
          <Text ellipsis fontSize={13} title={name}>
            {name}
          </Text>
        </div>
        {/* The reset times stay in text, not only in the tooltips: touch has no hover. */}
        <div data-resets {...stylex.props(styles.resets)}>
          {resets.length === 0 ? (
            <Text
              fontSize={12}
              style={{ color: failed ? cssVar.colorError : undefined }}
              type={failed ? undefined : 'secondary'}
            >
              {idleText}
            </Text>
          ) : (
            resets.map((reset) => (
              <Text
                ellipsis
                fontSize={12}
                key={reset.key}
                type={reset.exhausted ? undefined : 'secondary'}
                style={{
                  color: reset.exhausted ? cssVar.colorError : undefined,
                  whiteSpace: 'nowrap',
                }}
              >
                {windowLabel(reset.key, t)} ·{' '}
                {reset.estimated
                  ? t('subscriptionAccounts.calendar.latest', {
                      time: formatTime(reset.resetsAt, now, t),
                    })
                  : formatTime(reset.resetsAt, now, t)}
              </Text>
            ))
          )}
        </div>
      </div>

      <div {...stylex.props(styles.track(trackWidth))}>
        <DayLines axis={axis} midnights={midnights} />
        <span aria-hidden {...stylex.props(styles.nowLine(x(now, axis)))} />
        {note && <span {...stylex.props(styles.note(x(now, axis)))}>{note}</span>}
        {failed && (
          <span data-read-failed {...stylex.props(styles.failure(x(now, axis)))}>
            {t('subscriptionAccounts.calendar.failedNote')}
            <Button
              loading={isValidating}
              size={'small'}
              type={'link'}
              onClick={(e) => {
                // The row itself opens the account; retrying must not.
                e.stopPropagation();
                void revalidate();
              }}
            >
              {t('retry', { ns: 'common' })}
            </Button>
          </span>
        )}
        {drawWindows &&
          windows.map((window) => {
            const text = `${name} · ${formatRange(window.start, window.end, now, t)} · ${windowText(window, now, t)}`;
            return (
              <Tooltip key={window.start} title={text}>
                <span
                  aria-label={text}
                  data-start={window.start}
                  data-tight={window.tightBy ? true : undefined}
                  data-window={window.state}
                  role={'img'}
                  {...stylex.props(windowStyle(window, x(window.start, axis)))}
                >
                  {window.tightBy && <span aria-hidden {...stylex.props(styles.dot)} />}
                </span>
              </Tooltip>
            );
          })}
      </div>
    </div>
  );
};

interface QuotaCalendarProps {
  accounts: ProviderAccount[];
  /** The account whose side panel is open. */
  activeId?: string;
  /** Extra controls on the header's right, e.g. a link to manage the accounts. */
  extra?: ReactNode;
  /** Rows open the account when given; on their own they only inform. */
  onOpen?: (accountId: string) => void;
}

/**
 * Every subscription's 5-hour windows on one 7-day axis: the window under way
 * where it really is, then the ones after it. Grey windows are unused, blue
 * ones partly spent, hatched ones blocked; a dot marks one nearly used up. The
 * top row counts the accounts that can take work in each 5 hours from now.
 */
const QuotaCalendar = ({ accounts, activeId, extra, onOpen }: QuotaCalendarProps) => {
  const { t } = useTranslation('setting');
  const now = useNow();
  const readings = useAgentQuotaStore((s) => accounts.map((a) => s.quotaReadingsMap[a.id]));
  const axis = buildQuotaAxis(now);
  const trackWidth = x(axis.end, axis);
  const midnights = axisMidnights(axis);
  const views = accounts.map((account, index) => deriveAccountView(account, readings[index], now));
  const windowsByAccount = views.map((view) => accountWindows(view, axis, now));
  const summary = summarizeQuota(views, now);
  const failed = useAgentQuotaStore((s) =>
    accounts.map((a) => !!s.quotaReadingsFailed[a.id] && !s.quotaReadingsMap[a.id]),
  );
  // Counting before every account has answered would flash "0 available"; an
  // account whose read failed has answered, and is counted as unavailable.
  const allSettled = readings.every((entry, index) => entry !== undefined || failed[index]);
  const failedCount = failed.filter(Boolean).length;
  // Accounts that can take work at all: in rotation and reporting.
  const countable = views
    .map((view, index) => ({ view, windows: windowsByAccount[index] }))
    .filter(({ view }) => view.status !== 'disabled' && view.status !== 'noData');
  const inRotation = views.filter((view) => view.status !== 'disabled').length;

  const summaryParts = [
    t('subscriptionAccounts.calendar.summary.available', { count: summary.available }),
    summary.exhausted > 0 &&
      t('subscriptionAccounts.calendar.summary.exhausted', { count: summary.exhausted }),
    summary.nextRecoveryAt
      ? t('subscriptionAccounts.calendar.summary.nextRecovery', {
          time: dayjs(summary.nextRecoveryAt).from(now),
        })
      : summary.nextResetAt &&
        t('subscriptionAccounts.calendar.summary.nextReset', {
          time: dayjs(summary.nextResetAt).from(now),
        }),
    failedCount > 0 && t('subscriptionAccounts.calendar.summary.failed', { count: failedCount }),
  ].filter(Boolean);

  const legend = [
    { key: 'idle', style: styles.cell('0', cssVar.colorFillSecondary, 'none') },
    { key: 'used', style: styles.cell('0', usedColor(50), 'none') },
    { dot: true, key: 'tight', style: styles.cell('0', usedColor(85), 'none') },
    { key: 'blocked', style: styles.cell('0', 'transparent', HATCH(cssVar.colorError)) },
  ] as const;

  return (
    <section aria-label={t('subscriptionAccounts.calendar.title')} {...stylex.props(styles.card)}>
      <Flexbox horizontal align={'flex-start'} gap={12} justify={'space-between'} wrap={'wrap'}>
        <Flexbox gap={2}>
          <Text weight={500}>{t('subscriptionAccounts.calendar.title')}</Text>
          <Text fontSize={12} type={'secondary'}>
            {t('subscriptionAccounts.calendar.desc')}
          </Text>
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={12}>
          <Text aria-live={'polite'} fontSize={13}>
            {allSettled && summaryParts.join(' · ')}
          </Text>
          {extra}
        </Flexbox>
      </Flexbox>

      <Flexbox horizontal align={'center'} gap={16} wrap={'wrap'}>
        {legend.map((item) => (
          <Flexbox horizontal align={'center'} gap={6} key={item.key}>
            <span {...stylex.props(item.style, styles.swatch)}>
              {'dot' in item && <span aria-hidden {...stylex.props(styles.dot)} />}
            </span>
            <Text fontSize={12} type={'secondary'}>
              {t(`subscriptionAccounts.calendar.legend.${item.key}`)}
            </Text>
          </Flexbox>
        ))}
      </Flexbox>

      <div data-quota-scroller {...stylex.props(styles.scroller)}>
        {/* Day headers at each midnight, and "Now". */}
        <div {...stylex.props(styles.row)}>
          <div {...stylex.props(styles.lead)}>
            <div {...stylex.props(styles.name)} />
            <div {...stylex.props(styles.resets)} />
          </div>
          <div {...stylex.props(styles.track(trackWidth))}>
            <span {...stylex.props(styles.dayLabel(x(now, axis)))}>
              {t('subscriptionAccounts.calendar.now')}
            </span>
            {midnights.map((at) => (
              <span
                data-day-label
                key={at}
                title={dayjs(at).format('YYYY-MM-DD ddd')}
                {...stylex.props(styles.dayLabel(x(at, axis)))}
              >
                {dayName(at, now, t)}
              </span>
            ))}
          </div>
        </div>

        {/* How many accounts can take work in each 5 hours from now. */}
        <div {...stylex.props(styles.row)} data-team-row>
          <div {...stylex.props(styles.lead)}>
            <div {...stylex.props(styles.name)}>
              <Text fontSize={12} type={'secondary'}>
                {t('subscriptionAccounts.calendar.teamRow')}
              </Text>
            </div>
            <div {...stylex.props(styles.resets)} />
          </div>
          <div {...stylex.props(styles.track(trackWidth))}>
            <DayLines axis={axis} midnights={midnights} />
            {allSettled &&
              teamBuckets(now, axis).map((bucket) => {
                const middle = (bucket.start + bucket.end) / 2;
                const usable = countable.filter(({ windows }) =>
                  isUsableAt(windows, middle),
                ).length;
                const share = inRotation ? usable / inRotation : 0;
                const label = `${formatRange(bucket.start, bucket.end, now, t)} · ${t('subscriptionAccounts.calendar.teamCell', { count: usable, total: inRotation })}`;
                return (
                  <Tooltip key={bucket.start} title={label}>
                    <span
                      aria-label={label}
                      data-usable={usable}
                      {...stylex.props(
                        styles.cell(
                          x(bucket.start, axis),
                          `color-mix(in srgb, ${cssVar.colorInfo} ${Math.round(8 + share * 30)}%, transparent)`,
                          'none',
                        ),
                        styles.count(usable ? cssVar.colorText : cssVar.colorTextQuaternary),
                      )}
                    >
                      {usable}
                    </span>
                  </Tooltip>
                );
              })}
          </div>
        </div>

        {accounts.map((account, index) => (
          <AccountWindowsRow
            account={account}
            active={account.id === activeId}
            axis={axis}
            key={account.id}
            loaded={readings[index] !== undefined}
            now={now}
            trackWidth={trackWidth}
            view={views[index]}
            windows={windowsByAccount[index]}
            onOpen={onOpen ? () => onOpen(account.id) : undefined}
          />
        ))}
      </div>
    </section>
  );
};

export default QuotaCalendar;
