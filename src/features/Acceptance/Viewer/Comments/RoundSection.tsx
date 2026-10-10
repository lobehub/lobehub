'use client';

import { createStaticStyles, cssVar, cx,Icon  } from '@lobehub/ui';
import { ChevronRight } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useActivityTime } from '@/hooks/useActivityTime';

import type { DiscussionSection } from './discussionRounds';

const styles = createStaticStyles(({ css }) => ({
  chevron: css`
    flex: none;
    color: ${cssVar.colorTextQuaternary};
    transition: transform ${cssVar.motionDurationFast};
  `,
  chevronOpen: css`
    transform: rotate(90deg);
  `,
  header: css`
    cursor: pointer;

    display: flex;
    gap: 10px;
    align-items: center;

    width: 100%;
    min-height: 32px;
    padding: 0;
    border: none;

    font: inherit;
    color: ${cssVar.colorText};
    text-align: start;

    background: none;

    &:hover .round-section-rule {
      background: ${cssVar.colorBorder};
    }
  `,
  label: css`
    flex: none;
    font-size: 12px;
    font-weight: 600;
  `,
  meta: css`
    flex: none;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  rule: css`
    flex: 1;
    height: 1px;
    background: ${cssVar.colorBorderSecondary};
    transition: background ${cssVar.motionDurationFast};
  `,
  sentBack: css`
    flex: none;
    font-size: 12px;
    color: ${cssVar.colorWarningText};
  `,
}));

const SectionTime = ({ at }: { at: Date }) => {
  const time = useActivityTime(at);
  return <span title={time.title}>{time.text}</span>;
};

interface RoundSectionProps {
  children: ReactNode;
  onToggle: () => void;
  open: boolean;
  section: DiscussionSection;
}

const RoundSection = memo<RoundSectionProps>(({ children, onToggle, open, section }) => {
  const { t } = useTranslation('verify');
  const label =
    section.roundIndex === null
      ? t('acceptance.comments.beforeDelivery')
      : t('acceptance.comments.roundContext', { round: section.roundIndex });

  return (
    <section aria-label={label}>
      <button aria-expanded={open} className={styles.header} type={'button'} onClick={onToggle}>
        <Icon
          className={cx(styles.chevron, open && styles.chevronOpen)}
          icon={ChevronRight}
          size={14}
        />
        <span className={styles.label}>{label}</span>
        {section.sentBack && (
          <span className={styles.sentBack}>
            {t('acceptance.workspace.groups.status.rejected')}
          </span>
        )}
        <span className={cx(styles.rule, 'round-section-rule')} />
        <span className={styles.meta}>
          {t('acceptance.comments.sectionMessages', { count: section.messageCount })}
          {section.landedAt && (
            <>
              {' · '}
              <SectionTime at={section.landedAt} />
            </>
          )}
        </span>
      </button>
      {open && children}
    </section>
  );
});

RoundSection.displayName = 'AcceptanceRoundSection';

export default RoundSection;
