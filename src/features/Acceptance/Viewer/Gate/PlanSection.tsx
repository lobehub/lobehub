'use client';

import type { GoalReleaseGateDossier } from '@lobechat/types';
import { ActionIcon, Icon, Markdown } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown, ChevronRight, PanelLeftCloseIcon, PanelLeftOpenIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import GateSection from './GateSection';
import { planDigest } from './gateSummary';
import SkillDirectory from './SkillDirectory';
import { gateStyles } from './styles';
import { usePlanFiles } from './usePlanFiles';

const styles = stylex.create({
  card: {
    display: 'flex',
    flexDirection: 'column',
    paddingBlock: '12px',
    paddingInline: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '12px',
    fontSize: '14px',
    lineHeight: '22px',
    color: cssVar.colorTextSecondary,
  },
  content: { marginBlockStart: '12px' },
  fold: {
    cursor: 'pointer',
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    alignSelf: 'flex-start',
    margin: 0,
    padding: 0,
    borderWidth: 0,
    borderStyle: 'none',
    borderColor: 'currentcolor',
    borderRadius: '4px',
    font: 'inherit',
    fontSize: '12px',
    lineHeight: '20px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    appearance: 'none',
    backgroundColor: 'transparent',
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: '2px',
  },
  foldAfterDigest: { marginBlockStart: '4px' },
  summary: { margin: 0 },
  summaryClamped: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 3,
  },
  title: {
    fontWeight: 500,
    color: cssVar.colorText,
  },
});

const PlanSection = ({ plan }: { plan: GoalReleaseGateDossier['plan'] }) => {
  const { t } = useTranslation('verify');
  const [opened, setOpened] = useState(false);
  const { extraFiles, filesOpen, toggleFiles } = usePlanFiles(plan.skillId, plan.revision);
  const digest = planDigest(plan.content);
  const hasDigest = !!digest.title || !!digest.summary;
  const foldable = hasDigest && (!!plan.skillId || digest.hasMore);
  const open = opened || !hasDigest;
  const treeShown = open && filesOpen;

  const toggleTree = () => {
    if (open) {
      toggleFiles();
      return;
    }
    setOpened(true);
    if (!filesOpen) toggleFiles();
  };

  return (
    <GateSection
      title={t('acceptance.gate.planTitle')}
      extra={
        plan.skillName && (
          <span {...stylex.props(gateStyles.meta)}>
            {plan.skillName} · v{plan.revision}
            {extraFiles > 0 && ` · ${t('acceptance.gate.planFiles', { count: extraFiles + 1 })}`}
          </span>
        )
      }
      titleExtra={
        plan.skillId && (
          <ActionIcon
            icon={treeShown ? PanelLeftCloseIcon : PanelLeftOpenIcon}
            size={'small'}
            title={t(treeShown ? 'acceptance.gate.hideFiles' : 'acceptance.gate.showFiles')}
            onClick={toggleTree}
          />
        )
      }
    >
      <div {...stylex.props(styles.card)}>
        {!open && digest.title && <div {...stylex.props(styles.title)}>{digest.title}</div>}
        {!open && digest.summary && (
          <p {...stylex.props(styles.summary, foldable && styles.summaryClamped)}>
            {digest.summary}
          </p>
        )}
        {foldable && (
          <button
            aria-expanded={open}
            type="button"
            {...stylex.props(styles.fold, !open && styles.foldAfterDigest)}
            onClick={() => setOpened(!open)}
          >
            <Icon icon={open ? ChevronDown : ChevronRight} size={14} />
            {t(open ? 'acceptance.gate.planFold' : 'acceptance.gate.planRead')}
          </button>
        )}
        {open && (
          <div {...stylex.props(foldable && styles.content)}>
            {plan.skillId ? (
              <SkillDirectory
                fallbackContent={plan.content}
                filesOpen={filesOpen}
                revision={plan.revision}
                skillId={plan.skillId}
              />
            ) : (
              <Markdown fontSize={14} variant={'chat'}>
                {plan.content}
              </Markdown>
            )}
          </div>
        )}
      </div>
    </GateSection>
  );
};

export default PlanSection;
