'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  ChevronRightIcon,
  CircleCheckIcon,
  CircleXIcon,
  ExternalLinkIcon,
  MessageSquareTextIcon,
} from 'lucide-react';
import { memo, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import { type MarkdownElementProps } from '../type';
import {
  type ParsedScmEvent,
  parseScmEvent,
  type ScmEventAttributes,
  type ScmEventCheck,
  type ScmEventReview,
} from './parseScmEvent';
import logToggleStyles from './Render.module.css';

const NOT_LAST = ':not(:last-child)';

const styles = stylex.create({
  body: { paddingBlock: '2px', paddingInline: 0 },
  check: {
    paddingBlock: '8px',
    borderBlockEndWidth: { default: null, [NOT_LAST]: '1px' },
    borderBlockEndStyle: { default: null, [NOT_LAST]: 'solid' },
    borderBlockEndColor: { default: null, [NOT_LAST]: cssVar.colorBorderSecondary },
  },
  checkFailed: { color: cssVar.colorError },
  checkPassed: { color: cssVar.colorSuccess },
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
  },
  // The Markdown host paints anchors in the link colour; inside the card
  // a link reads as text and the trailing icon says it can be clicked.
  link: {
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    color: { 'default': 'inherit', ':hover': cssVar.colorTextSecondary },
    textDecoration: 'none',
  },
  log: {
    overflow: 'auto',
    maxBlockSize: '320px',
    marginBlockStart: '6px',
    marginBlockEnd: 0,
    marginInline: 0,
    paddingBlock: '8px',
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
  logToggle: {
    cursor: 'pointer',
    userSelect: 'none',
    display: 'inline-flex',
    flex: 'none',
    gap: '2px',
    alignItems: 'center',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
  },
  mono: { fontFamily: cssVar.fontFamilyCode, fontSize: '12px' },
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
  pillNeutral: {
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  pillWarning: {
    color: cssVar.colorWarning,
    backgroundColor: cssVar.colorWarningBg,
    backgroundImage: 'none',
  },
  review: {
    paddingBlock: '8px',
    borderBlockEndWidth: { default: null, [NOT_LAST]: '1px' },
    borderBlockEndStyle: { default: null, [NOT_LAST]: 'solid' },
    borderBlockEndColor: { default: null, [NOT_LAST]: cssVar.colorBorderSecondary },
  },
  reviewBody: {
    fontSize: '13px',
    lineHeight: 1.6,
    color: cssVar.colorText,
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
  },
  root: {
    overflow: 'hidden',
    inlineSize: '100%',
    minInlineSize: '320px',
    fontSize: '13px',
    textAlign: 'start',
  },
});

const PILL_STYLE: Record<string, (typeof styles)['pillDanger']> = {
  ci_failed: styles.pillDanger,
  review_changes_requested: styles.pillWarning,
  review_commented: styles.pillNeutral,
};

const isFailed = (check: ScmEventCheck) =>
  check.conclusion !== undefined && check.conclusion !== 'success';

/**
 * One line per check: what leads the line (the event pill when this is the
 * only check, else a pass/fail glyph), the name and conclusion, then the
 * details link and the log toggle on the same line. The log itself folds
 * out underneath.
 */
const CheckRow = memo<{ check: ScmEventCheck; leading?: ReactNode }>(({ check, leading }) => {
  const { t } = useTranslation('integration');
  const [open, setOpen] = useState(false);
  const failed = isFailed(check);

  return (
    <Flexbox {...stylex.props(styles.check)} gap={4}>
      <Flexbox horizontal align="center" gap={8}>
        {leading ?? (
          <Icon
            {...stylex.props(failed ? styles.checkFailed : styles.checkPassed)}
            icon={failed ? CircleXIcon : CircleCheckIcon}
            size="small"
          />
        )}
        <Text ellipsis style={{ minWidth: 0 }} weight={500}>
          {check.name}
        </Text>
        {check.conclusion ? (
          <Text style={{ flex: 'none', fontSize: 12 }} type="secondary">
            {check.conclusion}
          </Text>
        ) : null}
        <span style={{ flex: 1 }} />
        {check.url ? (
          <a {...stylex.props(styles.link)} href={check.url} rel="noreferrer" target="_blank">
            <Text style={{ fontSize: 12 }} type="secondary">
              {t('scmEvent.details')}
            </Text>
            <Icon icon={ExternalLinkIcon} size={12} />
          </a>
        ) : null}
        {check.log ? (
          <span
            {...sx([styles.logToggle], open ? logToggleStyles.logToggleOpen : undefined)}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? t('scmEvent.hideLog') : t('scmEvent.showLog')}
            <Icon icon={ChevronRightIcon} size={12} />
          </span>
        ) : null}
      </Flexbox>
      {check.log && open ? <pre {...stylex.props(styles.log)}>{check.log}</pre> : null}
    </Flexbox>
  );
});

CheckRow.displayName = 'ScmEventCheckRow';

const ReviewRow = memo<{ review: ScmEventReview }>(({ review }) => {
  const location = review.path
    ? `${review.path}${review.line ? `:${review.line}` : ''}`
    : undefined;
  const meta = [review.state?.replaceAll('_', ' '), location].filter(Boolean).join(' · ');
  const author = review.url ? (
    <a {...stylex.props(styles.link)} href={review.url} rel="noreferrer" target="_blank">
      @{review.author}
      <Icon icon={ExternalLinkIcon} size={12} />
    </a>
  ) : (
    `@${review.author}`
  );

  return (
    <Flexbox {...stylex.props(styles.review)} gap={4}>
      <Flexbox horizontal align="center" gap={8}>
        <Icon icon={MessageSquareTextIcon} size="small" style={{ opacity: 0.6 }} />
        <Text weight={500}>{author}</Text>
        {meta ? (
          <Text {...stylex.props(styles.mono)} type="secondary">
            {meta}
          </Text>
        ) : null}
      </Flexbox>
      <div {...sx([styles.reviewBody], undefined, { paddingInlineStart: 24 })}>{review.body}</div>
    </Flexbox>
  );
});

ReviewRow.displayName = 'ScmEventReviewRow';

/**
 * A GitHub-styled card for the wake-up message the SCM integration injects
 * into a conversation. The pull request is the message's sender (see the
 * user message header), so the card opens with one status
 * line that carries the event (as a pill) together with what it is about —
 * the failing check with its details link and log toggle, or the reviewers
 * — and the instruction the agent was given as a footer.
 */
const Render = memo<MarkdownElementProps<ScmEventAttributes>>(({ children, node }) => {
  const { t } = useTranslation('integration');
  const attrs = node?.properties ?? ({} as ScmEventAttributes);
  const text = typeof children === 'string' ? children : String(children ?? '');
  const parsed = useMemo<ParsedScmEvent>(() => parseScmEvent(text), [text]);

  const kindLabel = t(`scmEvent.kind.${attrs.kind}` as any, { defaultValue: attrs.kind });
  const pill = (
    <span {...stylex.props(styles.pill, PILL_STYLE[attrs.kind] ?? styles.pillNeutral)}>
      {kindLabel}
    </span>
  );

  const single = parsed.checks.length === 1 ? parsed.checks[0] : null;
  const many = parsed.checks.length > 1 ? parsed.checks : null;
  const reviewers = [...new Set(parsed.reviews.map((review) => `@${review.author}`))];

  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.body)}>
        {single ? <CheckRow check={single} leading={pill} /> : null}
        {many ? (
          <>
            <Flexbox horizontal align="center" {...stylex.props(styles.check)} gap={8}>
              {pill}
              <Text type="secondary">
                {t('scmEvent.failedChecks', {
                  count: many.filter((check) => isFailed(check)).length,
                })}
              </Text>
            </Flexbox>
            {many.map((check, index) => (
              <CheckRow check={check} key={`${check.name}-${index}`} />
            ))}
          </>
        ) : null}
        {!single && !many ? (
          <Flexbox horizontal align="center" {...stylex.props(styles.check)} gap={8}>
            {pill}
            {reviewers.length > 0 ? <Text type="secondary">{reviewers.join(' · ')}</Text> : null}
          </Flexbox>
        ) : null}
        {parsed.reviews.map((review, index) => (
          <ReviewRow key={`${review.author}-${index}`} review={review} />
        ))}
      </div>

      {parsed.instruction ? (
        <div {...stylex.props(styles.instruction)}>{parsed.instruction}</div>
      ) : null}
    </div>
  );
});

Render.displayName = 'ScmEventRender';

export default Render;
