'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRightIcon } from 'lucide-react';
import { memo, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type MarkdownElementProps } from '../type';
import { buildMcpEventCard } from './cardModel';
import {
  formatEventData,
  formatEventTime,
  type McpEventAttributes,
  type McpEventItem,
  parseMcpEvent,
} from './parseMcpEvent';

// The SCM event card's anatomy and tokens (status line with a pill, hairline
// rows, folded log, quiet instruction footer), so the two kinds of wake-up
// message read as one family.
const styles = stylex.create({
  body: { paddingBlock: '2px', paddingInline: 0 },
  data: {
    overflow: 'auto',
    maxBlockSize: '320px',
    marginBlockStart: '6px',
    marginBlockEnd: '0',
    marginInline: 0,
    paddingBlock: '8px',
    // lobe-design-ignore LOBE-SPACING-OFFGRID: same inset as the SCM card's log box, which this card mirrors
    paddingInline: '10px',
    borderRadius: cssVar.borderRadiusSM,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    lineHeight: 1.5,
    color: cssVar.colorTextSecondary,
    whiteSpace: 'pre',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  instruction: {
    paddingBlockStart: '8px',
    paddingBlockEnd: '2px',
    paddingInline: 0,
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    fontSize: '12px',
    lineHeight: 1.6,
    color: cssVar.colorTextTertiary,
    whiteSpace: 'pre-wrap',
  },
  pill: {
    flex: 'none',
    paddingBlock: '2px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontSize: '12px',
    fontWeight: 500,
    lineHeight: '18px',
  },
  pillDanger: {
    color: cssVar.colorError,
    backgroundColor: cssVar.colorErrorBg,
    backgroundImage: 'none',
  },
  pillEvent: {
    fontFamily: cssVar.fontFamilyCode,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  pillWarning: {
    color: cssVar.colorWarning,
    backgroundColor: cssVar.colorWarningBg,
    backgroundImage: 'none',
  },
  preview: {
    overflow: 'hidden',
    flex: '1',
    minInlineSize: 0,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  root: {
    overflow: 'hidden',
    inlineSize: '100%',
    minInlineSize: '320px',
    fontSize: '13px',
    textAlign: 'start',
  },
  row: {
    paddingBlock: '8px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: { 'default': cssVar.colorBorderSecondary, ':last-child': 'transparent' },
  },
  time: { flex: 'none', fontSize: '12px', color: cssVar.colorTextSecondary },
  toggle: {
    cursor: 'pointer',
    userSelect: 'none',
    display: 'inline-flex',
    flex: 'none',
    gap: '2px',
    alignItems: 'center',
    margin: 0,
    paddingBlock: 0,
    paddingInline: 0,
    borderWidth: 0,
    borderStyle: 'none',
    font: 'inherit',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '2px' },
  },
});

const Pill = ({
  children,
  tone,
}: {
  children: ReactNode;
  tone: 'danger' | 'event' | 'warning';
}) => (
  <span
    {...stylex.props(
      styles.pill,
      tone === 'danger'
        ? styles.pillDanger
        : tone === 'warning'
          ? styles.pillWarning
          : styles.pillEvent,
    )}
  >
    {children}
  </span>
);

/**
 * One event per line: when it happened and a one-line look at its data, with
 * the full data folded out underneath on request. The data is untrusted text
 * from the connector, so it renders as text in a `<pre>`, never as markup.
 */
const EventRow = memo<{ event: McpEventItem; leading?: ReactNode }>(({ event, leading }) => {
  const { t } = useTranslation('integration');
  const [open, setOpen] = useState(false);
  const data = useMemo(() => formatEventData(event.data), [event.data]);
  const time = formatEventTime(event.timestamp);

  return (
    <Flexbox gap={4} {...stylex.props(styles.row)}>
      <Flexbox horizontal align={'center'} gap={8}>
        {leading}
        {time && (
          <span title={event.timestamp} {...stylex.props(styles.time)}>
            {time}
          </span>
        )}
        <span title={data.preview} {...stylex.props(styles.preview)}>
          {data.preview}
        </span>
        {event.data && (
          <button
            aria-expanded={open}
            type={'button'}
            {...stylex.props(styles.toggle)}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? t('mcpEvent.hideData') : t('mcpEvent.showData')}
            <Icon
              icon={ChevronRightIcon}
              size={12}
              style={{ transform: open ? 'rotate(90deg)' : undefined }}
            />
          </button>
        )}
      </Flexbox>
      {open && <pre {...stylex.props(styles.data)}>{data.pretty}</pre>}
    </Flexbox>
  );
});

EventRow.displayName = 'McpEventRow';

/**
 * The card for the wake-up message the MCP Events integration injects into a
 * conversation. The connector is the message's sender (see the user message
 * header), so the card opens with the event: its type as a pill, then each
 * event that arrived in this batch. A batch the server cut short says how many
 * events were left out; a possible gap and an ended subscription each get
 * their own line; the instruction the user approved closes the card. The
 * system guidance for the model is never shown.
 */
const Render = memo<MarkdownElementProps<McpEventAttributes>>(({ children, node }) => {
  const { t } = useTranslation('integration');
  const attrs = node?.properties ?? ({} as McpEventAttributes);
  const text = typeof children === 'string' ? children : String(children ?? '');
  // Parsed once per block text, like the SCM card: the message list re-renders
  // this row on every streamed token elsewhere in the conversation.
  const { event, truncated } = attrs;
  const card = useMemo(
    () => buildMcpEventCard({ event, truncated }, parseMcpEvent(text)),
    [event, text, truncated],
  );

  const eventPill = card.eventName ? <Pill tone={'event'}>{card.eventName}</Pill> : null;
  const countText = card.count
    ? [
        t('mcpEvent.eventCount', { count: card.count.total }),
        card.count.omitted > 0 ? t('mcpEvent.omitted', { count: card.count.omitted }) : undefined,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined;

  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.body)}>
        {card.notice && (
          <Flexbox horizontal align={'center'} gap={8} {...stylex.props(styles.row)}>
            <Pill tone={'danger'}>
              {t(`mcpEvent.notice.${card.notice.kind}` as any, {
                defaultValue: t('mcpEvent.notice.subscription_terminated'),
              })}
            </Pill>
            {card.notice.namesEvent && eventPill}
            <Text type={'secondary'}>
              {t(`mcpEvent.noticeReason.${card.notice.reason}` as any, {
                defaultValue: t('mcpEvent.noticeReason.unknown'),
              })}
            </Text>
          </Flexbox>
        )}
        {card.single && <EventRow event={card.single} leading={eventPill} />}
        {countText && (
          <Flexbox horizontal align={'center'} gap={8} {...stylex.props(styles.row)}>
            {eventPill}
            <Text type={'secondary'}>{countText}</Text>
          </Flexbox>
        )}
        {card.events.map((event) => (
          <EventRow event={event} key={event.id} />
        ))}
        {card.onlyEventName && (
          <Flexbox horizontal align={'center'} gap={8} {...stylex.props(styles.row)}>
            {eventPill}
          </Flexbox>
        )}
        {card.truncated && (
          <Flexbox horizontal align={'center'} gap={8} {...stylex.props(styles.row)}>
            <Pill tone={'warning'}>{t('mcpEvent.truncated')}</Pill>
            <Text type={'secondary'}>{t('mcpEvent.truncatedDesc')}</Text>
          </Flexbox>
        )}
      </div>

      {card.instruction && <div {...stylex.props(styles.instruction)}>{card.instruction}</div>}
    </div>
  );
});

Render.displayName = 'McpEventRender';

export default Render;
