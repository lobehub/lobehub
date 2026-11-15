'use client';

import type { DropdownItem } from '@lobehub/ui';
import { DropdownMenu, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { resolveAcceptanceVerdictMeta } from '../verdict';

const styles = stylex.create({
  pill: {
    display: 'inline-flex',
    gap: '5px',
    alignItems: 'center',
    paddingBlock: '2px',
    paddingInline: '10px',
    borderRadius: '99px',
    fontSize: '12px',
    fontWeight: 500,
  },
  interactive: {
    cursor: 'pointer',
    transition: `filter ${cssVar.motionDurationMid}`,
    filter: { 'default': null, ':hover': 'brightness(1.08)' },
  },
});

interface AcceptanceStatusPillProps {
  menu?: DropdownItem[];
  pending?: boolean;
  size?: number;
  status: string;
}

const AcceptanceStatusPill = ({ menu, pending, size = 13, status }: AcceptanceStatusPillProps) => {
  const { t } = useTranslation('verify');
  const verdictMeta = resolveAcceptanceVerdictMeta(status, t);
  const pill = (
    <span
      title={menu ? t('acceptance.workspace.actions.status') : undefined}
      className={
        menu
          ? stylex.props(styles.pill, styles.interactive).className
          : stylex.props(styles.pill).className
      }
      style={{
        background: verdictMeta.bg,
        color: verdictMeta.color,
        pointerEvents: pending ? 'none' : undefined,
      }}
    >
      <Icon icon={verdictMeta.icon} size={size} spin={verdictMeta.spin} />
      {verdictMeta.label}
      {menu ? <Icon icon={ChevronDown} size={11} /> : null}
    </span>
  );

  return menu ? <DropdownMenu items={menu}>{pill}</DropdownMenu> : pill;
};

export default AcceptanceStatusPill;
