import type { DeviceGitLinkedPullRequest } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import { rowStyles } from '../Overview/OverviewRow';
import { sectionStyles } from '../Overview/sectionStyles';
import { getDetailVisual } from './prVisual';

export const headStyles = stylex.create({
  actions: { flexShrink: 0, marginBlockStart: '-2px' },
  meta: {
    flexWrap: 'wrap',
    marginBlockStart: '6px',
    fontSize: '12px',
    lineHeight: '18px',
    color: cssVar.colorTextTertiary,
  },
  ref: {
    overflow: 'hidden',
    maxWidth: '160px',
    paddingBlock: '1px',
    paddingInline: '6px',
    borderRadius: '4px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  // Composed after `ref`: a conditional value replaces the whole property, so the
  // resting colours are restated here.
  refButton: {
    cursor: 'pointer',
    display: 'inline-flex',
    gap: '3px',
    alignItems: 'center',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': cssVar.colorFillSecondary, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
  },
  root: { paddingBlockStart: '10px', paddingBlockEnd: '8px', paddingInline: '8px' },
  stats: { fontVariantNumeric: 'tabular-nums' },
  title: {
    flex: '1',
    minWidth: '0',
    fontSize: '15px',
    fontWeight: 600,
    lineHeight: '22px',
    color: cssVar.colorText,
    overflowWrap: 'anywhere',
  },
});

export const PrTitle = memo<{ number: number; title: string }>(({ number, title }) => (
  <span {...stylex.props(headStyles.title)}>
    <span {...stylex.props(rowStyles.num)}>#{number}</span>
    {title}
  </span>
));

PrTitle.displayName = 'PrTitle';

export const PrStatePill = memo<{
  pr: Pick<DeviceGitLinkedPullRequest, 'isDraft' | 'mergedAt' | 'state'>;
}>(({ pr }) => {
  const { t } = useTranslation('chat');
  const visual = getDetailVisual(pr);
  return (
    <span
      {...sx([sectionStyles.pill], undefined, {
        background: `color-mix(in srgb, ${visual.color} 12%, transparent)`,
        color: visual.color,
      })}
    >
      <Icon icon={visual.icon} size={12} />
      {t(`workingPanel.pr.state.${visual.state}`)}
    </span>
  );
});

PrStatePill.displayName = 'PrStatePill';

interface PrHeadProps {
  actions?: ReactNode;
  meta: ReactNode;
  title: ReactNode;
}

const PrHead = memo<PrHeadProps>(({ actions, meta, title }) => (
  <div {...stylex.props(headStyles.root)}>
    <Flexbox horizontal align={'flex-start'} gap={6}>
      {title}
      {actions && (
        <Flexbox horizontal {...stylex.props(headStyles.actions)} gap={2}>
          {actions}
        </Flexbox>
      )}
    </Flexbox>
    <Flexbox horizontal align={'center'} {...stylex.props(headStyles.meta)} gap={6}>
      {meta}
    </Flexbox>
  </div>
));

PrHead.displayName = 'PrHead';

export default PrHead;
