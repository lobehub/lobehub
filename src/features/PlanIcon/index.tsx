import { Plans } from '@lobechat/types';
import { createStaticStyles, cssVar, cx, Tag } from '@lobehub/ui';
import { type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { getPlanTagButtonProps } from './buttonProps';

// lobe-design-ignore-file LOBE-RAW-COLOR: tier badge palettes are brand art that must stay identical in light and dark themes; no cssVar token carries them

export interface PlanTheme {
  background?: string;
  color?: string;
}

export const themes = {
  [Plans.Free]: {
    theme: {
      background: undefined,
      color: undefined,
    },
  },
  [Plans.Hobby]: {
    theme: {
      background: 'linear-gradient(45deg, #21B2EE, #2271ED)',
      color: '#E5F8FF',
    },
  },
  [Plans.Starter]: {
    theme: {
      background: 'linear-gradient(45deg, #C57948, #803718)',
      color: '#FFC385',
    },
  },
  [Plans.Premium]: {
    theme: {
      background: 'linear-gradient(45deg, #A5B4C2, #606E7B)',
      color: '#FCFDFF',
    },
  },
  [Plans.Ultimate]: {
    theme: {
      background: 'linear-gradient(45deg, #F7A82F, #BB7227)',
      color: '#FCFA6E',
    },
  },
  [Plans.Plus]: {
    theme: {
      // lobe-design-ignore LOBE-PURPLE-GRADIENT: categorical hue that tells the Plus tier apart from the other tier badges, not a decorative hero gradient
      background: 'linear-gradient(45deg, #8B5CF6, #5B21B6)',
      color: '#EDE9FE',
    },
  },
  [Plans.Pro]: {
    theme: {
      background: 'linear-gradient(45deg, #10B981, #047857)',
      color: '#D1FAE5',
    },
  },
  [Plans.Max]: {
    theme: {
      background: 'linear-gradient(45deg, #374151, #111827)',
      color: '#FDE68A',
    },
  },
} satisfies Record<Plans, unknown>;

const styles = createStaticStyles(({ css }) => ({
  clickable: css`
    cursor: pointer;

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
  `,
  plain: css`
    cursor: default;
  `,
}));

export interface PlanTagProps {
  className?: string;
  label: string;
  /**
   * Makes the tag a keyboard-operable button (Enter / Space). Without it the tag is plain
   * text: no button role, no tab stop, and a default cursor.
   */
  onClick?: () => void;
  style?: CSSProperties;
  /** Gradient and text color. A missing background falls back to a neutral fill. */
  theme?: PlanTheme;
}

/** Name pill shared by the personal and workspace plan tags. */
export const PlanTag = ({ className, label, onClick, style, theme }: PlanTagProps) => (
  <Tag
    className={cx(onClick ? styles.clickable : styles.plain, className)}
    variant={'filled'}
    style={{
      background: theme?.background ?? cssVar.colorFillSecondary,
      border: 'none',
      borderRadius: 12,
      color: theme?.color ?? cssVar.colorText,
      flex: 'none',
      margin: 0,
      ...style,
    }}
    {...getPlanTagButtonProps(onClick)}
  >
    {label}
  </Tag>
);

interface PlanIconProps {
  className?: string;
  onClick?: () => void;
  plan: Plans;
  style?: CSSProperties;
}

/** Plan name pill. Plan icons are intentionally gone: the name is the only badge. */
const PlanIcon = ({ plan, ...rest }: PlanIconProps) => {
  const { t } = useTranslation('subscription');

  return <PlanTag {...rest} label={t(`plans.plan.${plan}.title`)} theme={themes[plan].theme} />;
};

export default PlanIcon;
