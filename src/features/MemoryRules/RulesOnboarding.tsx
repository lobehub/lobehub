'use client';

import { Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { BotIcon, ClipboardCheckIcon, FileSearchIcon, PlusIcon, ScaleIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

const styles = createStaticStyles(({ css }) => ({
  actions: css`
    margin-block: 24px 32px;
  `,
  description: css`
    margin: 0;
    line-height: 1.7;
    color: ${cssVar.colorTextSecondary};
  `,
  hero: css`
    display: flex;
    flex-direction: column;
    align-items: center;

    max-inline-size: 460px;

    text-align: center;
  `,
  heroIcon: css`
    display: flex;
    align-items: center;
    justify-content: center;

    inline-size: 56px;
    block-size: 56px;
    margin-block-end: 24px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 14px;

    color: ${cssVar.colorText};

    background: ${cssVar.colorFillQuaternary};
  `,
  inline: css`
    padding-block: 40px;
  `,
  list: css`
    inline-size: 100%;
    max-inline-size: 640px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  listTitle: css`
    inline-size: 100%;
    max-inline-size: 640px;
    margin-block-end: 8px;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
  `,
  row: css`
    display: flex;
    gap: 14px;
    align-items: center;

    padding-block: 16px;
    padding-inline: 20px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  rowAction: css`
    flex: none;

    > * {
      min-inline-size: 72px;
    }
  `,
  rowCopy: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;

    min-inline-size: 0;
  `,
  rowDescription: css`
    overflow: hidden;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  rowIcon: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    inline-size: 36px;
    block-size: 36px;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  rowMeta: css`
    flex: none;
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
  rowTitle: css`
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  shell: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-block: 72px 48px;
  `,
  title: css`
    margin-block: 0 8px;
    margin-inline: 0;

    font-size: 18px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
}));

interface RowProps {
  action?: ReactNode;
  description: ReactNode;
  icon: typeof ScaleIcon;
  meta?: ReactNode;
  title: string;
}

const Row = ({ action, description, icon, meta, title }: RowProps) => (
  <div className={styles.row}>
    <span className={styles.rowIcon}>
      <Icon icon={icon} size={18} />
    </span>
    <span className={styles.rowCopy}>
      <span className={styles.rowTitle}>{title}</span>
      <span className={styles.rowDescription}>{description}</span>
    </span>
    {meta && <span className={styles.rowMeta}>{meta}</span>}
    {action && <span className={styles.rowAction}>{action}</span>}
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
    <div className={cx(styles.shell, inline && styles.inline)}>
      <div className={styles.hero}>
        <div className={styles.heroIcon}>
          <Icon icon={ScaleIcon} size={24} />
        </div>
        <h2 className={styles.title}>{t('rules.onboarding.title')}</h2>
        <p className={styles.description}>
          {t('rules.onboarding.description')}
          <br />
          {t('rules.onboarding.descriptionGrow')}
        </p>
      </div>

      <div className={styles.actions}>
        <Button icon={<Icon icon={PlusIcon} />} type={'primary'} onClick={onWrite}>
          {t('rules.onboarding.write')}
        </Button>
      </div>

      <div className={styles.listTitle}>{t('rules.onboarding.listTitle')}</div>
      <div className={styles.list}>
        <Row
          action={<Button onClick={onDistill}>{t('rules.onboarding.distill.action')}</Button>}
          description={t('rules.onboarding.distill.description')}
          icon={FileSearchIcon}
          title={t('rules.onboarding.distill.title')}
        />
        <Row
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
