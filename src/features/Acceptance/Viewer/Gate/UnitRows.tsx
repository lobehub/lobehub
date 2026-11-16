'use client';

import type { GoalReleaseGateUnit } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check, CircleDashed, Info, type LucideIcon, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { splitUnitTitle, type UnitRemark, unitRemark } from './gateSummary';
import { gateStyles } from './styles';
import { useUnitMeta } from './useUnitMeta';

const compact = '@media (width <= 767px)';

const styles = stylex.create({
  glyph: { display: 'inline-flex', width: '16px' },
  list: {
    display: 'grid',
    // A fixed first track would lose the row's inline padding: a subgrid's
    // padding is taken out of its edge tracks.
    gridTemplateColumns: 'auto auto minmax(0, 1fr) auto',
    columnGap: '8px',
    borderBlockWidth: '1px',
    borderBlockStyle: 'solid',
    borderBlockColor: cssVar.colorBorderSecondary,
  },
  meta: {
    gridColumnEnd: { default: null, [compact]: '-1' },
    gridColumnStart: { default: null, [compact]: '3' },
    whiteSpace: { default: 'nowrap', [compact]: 'normal' },
  },
  name: {
    overflow: 'hidden',
    minWidth: 0,
    fontSize: '14px',
    lineHeight: '22px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  nameWithoutCode: { gridColumnEnd: '4', gridColumnStart: '2' },
  remark: {
    gridColumnEnd: '-1',
    gridColumnStart: '3',
    fontSize: '12px',
    lineHeight: '20px',
    color: cssVar.colorWarningText,
  },
  remarkWithoutCode: { gridColumnEnd: '-1', gridColumnStart: '2' },
  row: {
    cursor: 'pointer',
    display: 'grid',
    gridColumnEnd: '-1',
    gridColumnStart: '1',
    gridTemplateColumns: 'subgrid',
    rowGap: 0,
    alignItems: 'center',
    minHeight: '48px',
    margin: 0,
    paddingBlock: '12px',
    paddingInline: '16px',
    borderInlineWidth: 0,
    borderBlockEndWidth: 0,
    borderBlockStartWidth: { 'default': 0, ':not(:first-child)': '1px' },
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    font: 'inherit',
    color: cssVar.colorText,
    textAlign: 'start',
    appearance: 'none',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillQuaternary },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: '-2px',
  },
  rowActive: {
    backgroundColor: { 'default': cssVar.colorFillTertiary, ':hover': cssVar.colorFillTertiary },
  },
});

export const UnitList = ({ children }: { children: ReactNode }) => (
  <div {...stylex.props(styles.list)}>{children}</div>
);

interface UnitRowProps {
  active: boolean;
  glyph: { color: string; icon: LucideIcon };
  meta: string;
  onSelect: () => void;
  remark?: string;
  title: string;
}

const UnitRow = ({ active, glyph, meta, onSelect, remark, title }: UnitRowProps) => {
  const { code, name } = splitUnitTitle(title);
  return (
    <button
      aria-pressed={active}
      type="button"
      {...stylex.props(styles.row, active && styles.rowActive)}
      onClick={onSelect}
    >
      <span {...stylex.props(styles.glyph)}>
        <Icon color={glyph.color} icon={glyph.icon} size={16} />
      </span>
      {code && <span {...stylex.props(gateStyles.code)}>{code}</span>}
      <span {...stylex.props(styles.name, !code && styles.nameWithoutCode)}>{name}</span>
      <span {...stylex.props(gateStyles.meta, styles.meta)}>{meta}</span>
      {remark && (
        <span {...stylex.props(styles.remark, !code && styles.remarkWithoutCode)}>{remark}</span>
      )}
    </button>
  );
};

const SETTLED_GLYPH = { color: cssVar.colorSuccess, icon: Check };
const WAITING_GLYPH = { color: cssVar.colorTextQuaternary, icon: CircleDashed };
const REMARK_GLYPH: Record<UnitRemark['kind'], UnitRowProps['glyph']> = {
  reworked: { color: cssVar.colorWarning, icon: Info },
  reworkedCostly: { color: cssVar.colorWarning, icon: Info },
  unsettled: { color: cssVar.colorWarning, icon: TriangleAlert },
};

interface ResultRowProps {
  active: boolean;
  average: number;
  onSelect: () => void;
  unit: GoalReleaseGateUnit;
}

export const ResultRow = ({ active, average, onSelect, unit }: ResultRowProps) => {
  const { t } = useTranslation('verify');
  const unitMeta = useUnitMeta();
  const remark = unitRemark(unit, average);

  const remarkText = () => {
    switch (remark?.kind) {
      case 'unsettled': {
        return t('acceptance.gate.unitUnsettled');
      }
      case 'reworkedCostly': {
        return t('acceptance.gate.unitReworkedCostly', {
          count: remark.rework,
          ratio: remark.ratio,
        });
      }
      case 'reworked': {
        return t('acceptance.gate.unitReworked', { count: remark.rework });
      }
    }
  };

  return (
    <UnitRow
      active={active}
      glyph={remark ? REMARK_GLYPH[remark.kind] : SETTLED_GLYPH}
      meta={unitMeta(unit)}
      remark={remarkText()}
      title={unit.title}
      onSelect={onSelect}
    />
  );
};

interface NextRowProps {
  active: boolean;
  onSelect: () => void;
  title: string;
}

export const NextRow = ({ active, onSelect, title }: NextRowProps) => {
  const { t } = useTranslation('verify');
  return (
    <UnitRow
      active={active}
      glyph={WAITING_GLYPH}
      meta={t('acceptance.gate.unitWaiting')}
      title={title}
      onSelect={onSelect}
    />
  );
};
