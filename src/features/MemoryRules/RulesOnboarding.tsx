'use client';

import { Button, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { BotIcon, ClipboardCheckIcon, FileSearchIcon, PlusIcon, ScaleIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { sx } from '@/styles/sx';

import moduleStyles from './RulesOnboarding.module.css';

const styles = stylex.create({
  actions: {
    marginBlockStart: '24px',
    marginBlockEnd: '32px',
  },
  description: {
    margin: 0,
    lineHeight: 1.7,
    color: cssVar.colorTextSecondary,
  },
  hero: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    maxInlineSize: '460px',
    textAlign: 'center',
  },
  heroIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    inlineSize: '56px',
    blockSize: '56px',
    marginBlockEnd: '24px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '14px',
    color: cssVar.colorText,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  inline: {
    paddingBlock: '40px',
  },
  list: {
    inlineSize: '100%',
    maxInlineSize: '640px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
  },
  listTitle: {
    inlineSize: '100%',
    maxInlineSize: '640px',
    marginBlockEnd: '8px',
    fontSize: cssVar.fontSizeSM,
    color: cssVar.colorTextSecondary,
  },
  row: {
    display: 'flex',
    gap: '14px',
    alignItems: 'center',
    paddingBlock: '16px',
    paddingInline: '20px',
  },
  // Every row after the first is separated from the one above.
  rowSeparated: {
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  rowAction: {
    flex: 'none',
  },
  rowCopy: {
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    gap: '2px',
    minInlineSize: 0,
  },
  rowDescription: {
    overflow: 'hidden',
    fontSize: cssVar.fontSizeSM,
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rowIcon: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    inlineSize: '36px',
    blockSize: '36px',
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  rowMeta: {
    flex: 'none',
    fontSize: cssVar.fontSizeSM,
    color: cssVar.colorTextTertiary,
  },
  rowTitle: {
    fontWeight: 500,
    color: cssVar.colorText,
  },
  shell: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    paddingBlockStart: '72px',
    paddingBlockEnd: '48px',
  },
  title: {
    marginBlockStart: 0,
    marginBlockEnd: '8px',
    marginInline: 0,
    fontSize: '18px',
    fontWeight: 600,
    color: cssVar.colorText,
  },
});

interface RowProps {
  action?: ReactNode;
  description: ReactNode;
  icon: typeof ScaleIcon;
  meta?: ReactNode;
  /** Draws the divider above the row (every row but the first). */
  separated?: boolean;
  title: string;
}

const Row = ({ action, description, icon, meta, separated, title }: RowProps) => (
  <div {...stylex.props(styles.row, separated && styles.rowSeparated)}>
    <span {...stylex.props(styles.rowIcon)}>
      <Icon icon={icon} size={18} />
    </span>
    <span {...stylex.props(styles.rowCopy)}>
      <span {...stylex.props(styles.rowTitle)}>{title}</span>
      <span {...stylex.props(styles.rowDescription)}>{description}</span>
    </span>
    {meta && <span {...stylex.props(styles.rowMeta)}>{meta}</span>}
    {action && <span {...sx([styles.rowAction], moduleStyles.rowAction)}>{action}</span>}
  </div>
);

export interface RulesOnboardingAgents {
  /** How many agents have learned something, and how many lessons in force across them. */
  agentCount: number;
  lessonCount: number;
  /** The first agent's name, used when there is only one. */
  name: string;
  onOpen: () => void;
}

interface RulesOnboardingProps {
  /** Present when agents have learned on their own, so there is something to look at already. */
  agents?: RulesOnboardingAgents;
  /** Rejected rounds no rule has been distilled from yet. */
  backlogRounds?: number;
  /** Inside the page under the part switcher, rather than as the whole page. */
  inline?: boolean;
  /** Read rules out of a material the reviewer already has. */
  onDistill: () => void;
  onWrite: () => void;
}

/**
 * The first screen of "My rules" while the reviewer has none: one centred column whose hero is
 * the one thing that can be done right here (write a rule — a sentence or a pasted guideline),
 * then the other places rules come from, each with the single action that gets there.
 */
const RulesOnboarding = ({
  agents,
  backlogRounds,
  inline,
  onDistill,
  onWrite,
}: RulesOnboardingProps) => {
  const { t } = useTranslation('memory');
  const navigate = useWorkspaceAwareNavigate();

  return (
    <div {...stylex.props(styles.shell, inline && styles.inline)}>
      <div {...stylex.props(styles.hero)}>
        <div {...stylex.props(styles.heroIcon)}>
          <Icon icon={ScaleIcon} size={24} />
        </div>
        <h2 {...stylex.props(styles.title)}>{t('rules.onboarding.title')}</h2>
        <p {...stylex.props(styles.description)}>
          {t('rules.onboarding.description')}
          <br />
          {t('rules.onboarding.descriptionGrow')}
        </p>
      </div>

      <div {...stylex.props(styles.actions)}>
        <Button icon={<Icon icon={PlusIcon} />} type={'primary'} onClick={onWrite}>
          {t('rules.onboarding.write')}
        </Button>
      </div>

      <div {...stylex.props(styles.listTitle)}>{t('rules.onboarding.listTitle')}</div>
      <div {...stylex.props(styles.list)}>
        <Row
          action={<Button onClick={onDistill}>{t('rules.onboarding.distill.action')}</Button>}
          description={t('rules.onboarding.distill.description')}
          icon={FileSearchIcon}
          title={t('rules.onboarding.distill.title')}
        />
        <Row
          separated
          description={t('rules.onboarding.reject.description')}
          icon={ClipboardCheckIcon}
          meta={backlogRounds ? t('rules.onboarding.backlog', { count: backlogRounds }) : undefined}
          title={t('rules.onboarding.reject.title')}
          action={
            <Button onClick={() => navigate('/acceptance')}>
              {t('rules.onboarding.reject.action')}
            </Button>
          }
        />
        {agents && (
          <Row
            separated
            action={<Button onClick={agents.onOpen}>{t('rules.onboarding.agents.action')}</Button>}
            icon={BotIcon}
            title={t('rules.onboarding.agents.title')}
            description={
              agents.agentCount > 1
                ? t('rules.onboarding.agents.descriptionMany', {
                    agents: agents.agentCount,
                    count: agents.lessonCount,
                  })
                : t('rules.onboarding.agents.description', {
                    count: agents.lessonCount,
                    name: agents.name,
                  })
            }
          />
        )}
      </div>
    </div>
  );
};

export default RulesOnboarding;
