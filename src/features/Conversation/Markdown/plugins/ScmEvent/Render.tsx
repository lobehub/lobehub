'use client';

import { Github } from '@lobehub/icons';
import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import {
  ChevronRightIcon,
  CircleCheckIcon,
  CircleXIcon,
  ExternalLinkIcon,
  MessageSquareTextIcon,
} from 'lucide-react';
import { memo, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type MarkdownElementProps } from '../type';
import {
  type ParsedScmEvent,
  parseScmEvent,
  safeScmUrl,
  type ScmEventAttributes,
  type ScmEventCheck,
  type ScmEventReview,
} from './parseScmEvent';

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    padding-block: 2px;
    padding-inline: 0;
  `,
  check: css`
    padding-block: 8px;

    &:not(:last-child) {
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  checkFailed: css`
    color: ${cssVar.colorError};
  `,
  checkPassed: css`
    color: ${cssVar.colorSuccess};
  `,
  header: css`
    padding-block: 4px 10px;
    padding-inline: 0;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  instruction: css`
    padding-block: 8px 2px;
    padding-inline: 0;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextTertiary};
  `,
  link: css`
    /* The Markdown host paints anchors in the link colour; inside the card
       a link reads as text and the trailing icon says it can be clicked. */
    display: inline-flex;
    gap: 4px;
    align-items: center;

    color: inherit !important;
    text-decoration: none;

    &:hover {
      color: ${cssVar.colorTextSecondary} !important;
      text-decoration: none;
    }
  `,
  log: css`
    overflow: auto;

    max-block-size: 320px;
    margin-block: 6px 0;
    margin-inline: 0;
    padding-block: 8px;
    padding-inline: 10px;
    border-radius: ${cssVar.borderRadiusSM};

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
    white-space: pre;

    background: ${cssVar.colorFillQuaternary};
  `,
  logToggle: css`
    cursor: pointer;
    user-select: none;

    display: inline-flex;
    flex: none;
    gap: 2px;
    align-items: center;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  logToggleOpen: css`
    svg {
      transform: rotate(90deg);
    }
  `,
  mark: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    inline-size: 28px;
    block-size: 28px;
    border-radius: 6px;

    color: ${cssVar.colorText};

    background: ${cssVar.colorFillTertiary};
  `,
  mono: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
  `,
  pill: css`
    flex: none;

    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
    font-weight: 500;
    line-height: 18px;
  `,
  pillDanger: css`
    color: ${cssVar.colorError};
    background: ${cssVar.colorErrorBg};
  `,
  pillNeutral: css`
    color: ${cssVar.colorTextSecondary};
    background: ${cssVar.colorFillSecondary};
  `,
  pillWarning: css`
    color: ${cssVar.colorWarning};
    background: ${cssVar.colorWarningBg};
  `,
  review: css`
    padding-block: 8px;

    &:not(:last-child) {
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  reviewBody: css`
    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorText};
    word-break: break-word;
    white-space: pre-wrap;
  `,
  root: css`
    overflow: hidden;

    inline-size: 100%;
    min-inline-size: 320px;

    font-size: 13px;
    text-align: start;
  `,
}));

const PILL_STYLE: Record<string, string> = {
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
    <Flexbox className={styles.check} gap={4}>
      <Flexbox horizontal align="center" gap={8}>
        {leading ?? (
          <Icon
            className={failed ? styles.checkFailed : styles.checkPassed}
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
          <a className={styles.link} href={check.url} rel="noreferrer" target="_blank">
            <Text style={{ fontSize: 12 }} type="secondary">
              {t('scmEvent.details')}
            </Text>
            <Icon icon={ExternalLinkIcon} size={12} />
          </a>
        ) : null}
        {check.log ? (
          <span
            className={cx(styles.logToggle, open && styles.logToggleOpen)}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? t('scmEvent.hideLog') : t('scmEvent.showLog')}
            <Icon icon={ChevronRightIcon} size={12} />
          </span>
        ) : null}
      </Flexbox>
      {check.log && open ? <pre className={styles.log}>{check.log}</pre> : null}
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
    <a className={styles.link} href={review.url} rel="noreferrer" target="_blank">
      @{review.author}
      <Icon icon={ExternalLinkIcon} size={12} />
    </a>
  ) : (
    `@${review.author}`
  );

  return (
    <Flexbox className={styles.review} gap={4}>
      <Flexbox horizontal align="center" gap={8}>
        <Icon icon={MessageSquareTextIcon} size="small" style={{ opacity: 0.6 }} />
        <Text weight={500}>{author}</Text>
        {meta ? (
          <Text className={styles.mono} type="secondary">
            {meta}
          </Text>
        ) : null}
      </Flexbox>
      <div className={styles.reviewBody} style={{ paddingInlineStart: 24 }}>
        {review.body}
      </div>
    </Flexbox>
  );
});

ReviewRow.displayName = 'ScmEventReviewRow';

/**
 * A GitHub-styled card for the wake-up message the SCM integration injects
 * into a conversation: the pull request in the header, then one status
 * line that carries the event (as a pill) together with what it is about —
 * the failing check with its details link and log toggle, or the reviewers
 * — and the instruction the agent was given as a footer.
 */
const Render = memo<MarkdownElementProps<ScmEventAttributes>>(({ children, node }) => {
  const { t } = useTranslation('integration');
  const attrs = node?.properties ?? ({} as ScmEventAttributes);
  const text = typeof children === 'string' ? children : String(children ?? '');
  const parsed = useMemo<ParsedScmEvent>(() => parseScmEvent(text), [text]);

  const title = attrs.repo
    ? `${attrs.repo}${attrs.number ? ` #${attrs.number}` : ''}`
    : (attrs.url ?? '');
  const kindLabel = t(`scmEvent.kind.${attrs.kind}` as any, { defaultValue: attrs.kind });
  const subtitle = [attrs.branch, attrs.sha].filter(Boolean).join(' @ ');
  const pill = (
    <span className={cx(styles.pill, PILL_STYLE[attrs.kind] ?? styles.pillNeutral)}>
      {kindLabel}
    </span>
  );

  // The header link is a tag attribute, so it skips the parser's guard.
  const headerUrl = safeScmUrl(attrs.url);
  const single = parsed.checks.length === 1 ? parsed.checks[0] : null;
  const many = parsed.checks.length > 1 ? parsed.checks : null;
  const reviewers = [...new Set(parsed.reviews.map((review) => `@${review.author}`))];

  return (
    <div className={styles.root}>
      <Flexbox horizontal align="center" className={styles.header} gap={10}>
        <span className={styles.mark}>
          <Github size={16} />
        </span>
        <Flexbox flex={1} gap={1} style={{ minWidth: 0 }}>
          <Text ellipsis weight={500}>
            {headerUrl ? (
              <a className={styles.link} href={headerUrl} rel="noreferrer" target="_blank">
                {title}
                <Icon icon={ExternalLinkIcon} size={12} />
              </a>
            ) : (
              title
            )}
          </Text>
          {subtitle ? (
            <Text ellipsis className={styles.mono} type="secondary">
              {subtitle}
            </Text>
          ) : null}
        </Flexbox>
      </Flexbox>

      <div className={styles.body}>
        {single ? <CheckRow check={single} leading={pill} /> : null}
        {many ? (
          <>
            <Flexbox horizontal align="center" className={styles.check} gap={8}>
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
          <Flexbox horizontal align="center" className={styles.check} gap={8}>
            {pill}
            {reviewers.length > 0 ? <Text type="secondary">{reviewers.join(' · ')}</Text> : null}
          </Flexbox>
        ) : null}
        {parsed.reviews.map((review, index) => (
          <ReviewRow key={`${review.author}-${index}`} review={review} />
        ))}
      </div>

      {parsed.instruction ? <div className={styles.instruction}>{parsed.instruction}</div> : null}
    </div>
  );
});

Render.displayName = 'ScmEventRender';

export default Render;
