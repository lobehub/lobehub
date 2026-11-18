'use client';

import type { GoalReleaseGateUnit } from '@lobechat/types';
import { ActionIcon, DraggablePanel, Markdown } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';

import { acceptanceOverviewPath } from '../routes';
import { splitUnitTitle } from './gateSummary';
import { gateStyles } from './styles';
import UnitArtifacts from './UnitArtifacts';
import { useUnitMeta } from './useUnitMeta';

const PANEL_WIDTH = { default: 360, max: 720, min: 280 };

const ORIGIN_TAG = /^\[origin=\w+\]\s*/;

export type GateSelection =
  { kind: 'result'; unit: GoalReleaseGateUnit } | { brief?: string; kind: 'next'; title: string };

export const selectionKey = (selection?: GateSelection) =>
  selection?.kind === 'result' ? selection.unit.nodeId : selection?.title;

const styles = stylex.create({
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  head: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start',
  },
  link: {
    alignSelf: 'flex-start',
    fontSize: '12px',
    lineHeight: '20px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    textDecorationLine: 'underline',
    textUnderlineOffset: '2px',
  },
  name: {
    flex: '1',
    minWidth: 0,
    fontSize: '14px',
    fontWeight: 600,
    lineHeight: '22px',
    color: cssVar.colorText,
    overflowWrap: 'anywhere',
  },
  docked: {
    overflowX: 'hidden',
    overflowY: 'auto',
    height: '100%',
    paddingBlock: '24px',
    paddingInline: '24px',
    borderInlineStartWidth: '1px',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgContainer,
  },
  panel: {
    overflowX: 'hidden',
    overflowY: 'auto',
    height: '100%',
    paddingBlock: '24px',
    paddingInline: '16px',
  },
  titleCode: { paddingBlockStart: '1px' },
});

interface UnitPanelProps {
  docked?: boolean;
  onClose: () => void;
  selection: GateSelection;
}

const UnitPanel = ({ docked, onClose, selection }: UnitPanelProps) => {
  const { t } = useTranslation('verify');
  const workspaceSlug = useActiveWorkspaceSlug();
  const unitMeta = useUnitMeta();
  const unit = selection.kind === 'result' ? selection.unit : undefined;
  const { brief, title } = selection.kind === 'result' ? selection.unit : selection;
  const { code, name } = splitUnitTitle(title);

  const body = (
    <div {...stylex.props(styles.body)}>
      <div {...stylex.props(styles.head)}>
        {code && <span {...stylex.props(gateStyles.code, styles.titleCode)}>{code}</span>}
        <span {...stylex.props(styles.name)}>{name}</span>
        <ActionIcon
          icon={X}
          size={'small'}
          title={t('acceptance.gate.panelClose')}
          onClick={onClose}
        />
      </div>
      <span {...stylex.props(gateStyles.label)}>
        {unit ? unitMeta(unit) : t('acceptance.gate.unitWaitingHint')}
      </span>
      {unit?.acceptance && (
        <a
          href={buildWorkspaceAwarePath(acceptanceOverviewPath(unit.acceptance.id), workspaceSlug)}
          rel="noreferrer"
          target="_blank"
          {...stylex.props(styles.link)}
        >
          {t('acceptance.gate.unitAcceptanceOpen')}
        </a>
      )}
      {brief && (
        <div>
          <div {...stylex.props(gateStyles.label)}>{t('acceptance.gate.unitBrief')}</div>
          <Markdown fontSize={14} variant={'chat'}>
            {brief.replace(ORIGIN_TAG, '')}
          </Markdown>
        </div>
      )}
      {unit && <UnitArtifacts unit={unit} />}
    </div>
  );

  if (docked) return <div {...stylex.props(styles.docked)}>{body}</div>;

  return (
    <DraggablePanel
      backgroundColor={'transparent'}
      classNames={{ content: stylex.props(styles.panel).className }}
      defaultSize={{ height: '100%', width: PANEL_WIDTH.default }}
      expandable={false}
      maxWidth={PANEL_WIDTH.max}
      minWidth={PANEL_WIDTH.min}
      placement={'right'}
    >
      {body}
    </DraggablePanel>
  );
};

export default UnitPanel;
