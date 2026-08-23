'use client';

import { Icon } from '@lobehub/ui';
import type { DropdownItem } from '@lobehub/ui/base-ui';
import { DropdownMenu } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { resolveAcceptanceVerdictMeta } from './verdict';

const styles = createStaticStyles(({ css }) => ({
  pill: css`
    display: inline-flex;
    gap: 5px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 10px;
    border-radius: 99px;

    font-size: 12px;
    font-weight: 500;
  `,
  interactive: css`
    cursor: pointer;
    transition: filter ${cssVar.motionDurationMid};

    &:hover {
      filter: brightness(1.08);
    }
  `,
}));

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
      className={menu ? cx(styles.pill, styles.interactive) : styles.pill}
      title={menu ? t('acceptance.workspace.actions.status') : undefined}
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
