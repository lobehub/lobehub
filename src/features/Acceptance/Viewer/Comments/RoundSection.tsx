'use client';

import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useActivityTime } from '@/hooks/useActivityTime';

import { roundHeaderMarker } from '../markers.stylex';
import type { DiscussionSection } from './discussionRounds';

const styles = stylex.create({
  chevron: {
    flex: 'none',
    color: cssVar.colorTextQuaternary,
    transition: `transform ${cssVar.motionDurationFast}`,
  },
  chevronOpen: {
    transform: 'rotate(90deg)',
  },
  header: {
    cursor: 'pointer',
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    width: '100%',
    minHeight: '32px',
    padding: 0,
    borderStyle: 'none',
    font: 'inherit',
    color: cssVar.colorText,
    textAlign: 'start',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
  },
  label: {
    flex: 'none',
    fontSize: '12px',
    fontWeight: 600,
  },
  meta: {
    flex: 'none',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  rule: {
    flex: '1',
    height: '1px',
    backgroundColor: {
      default: cssVar.colorBorderSecondary,
      [stylex.when.ancestor(':hover', roundHeaderMarker)]: cssVar.colorBorder,
    },
    transition: `background-color ${cssVar.motionDurationFast}`,
  },
  sentBack: {
    flex: 'none',
    fontSize: '12px',
    color: cssVar.colorWarningText,
  },
});

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
      <button
        aria-expanded={open}
        type={'button'}
        {...stylex.props(styles.header, roundHeaderMarker)}
        onClick={onToggle}
      >
        <Icon
          icon={ChevronRight}
          size={14}
          {...stylex.props(styles.chevron, open && styles.chevronOpen)}
        />
        <span {...stylex.props(styles.label)}>{label}</span>
        {section.sentBack && (
          <span {...stylex.props(styles.sentBack)}>
            {t('acceptance.workspace.groups.status.rejected')}
          </span>
        )}
        <span {...stylex.props(styles.rule)} />
        <span {...stylex.props(styles.meta)}>
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
