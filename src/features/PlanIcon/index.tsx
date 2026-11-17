import { createStaticStyles, cssVar, cx, Tag } from '@lobehub/ui';
import { type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { getPlanTagButtonProps } from './buttonProps';
import { getPlanTheme, getUnknownPlanTitle, type PlanTheme } from './theme';

export { getPlanTheme, getUnknownPlanTitle, type PlanTheme, themes } from './theme';

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
  /** A `Plans` value; typed as string because the server may send a plan newer than this build. */
  plan: string;
  style?: CSSProperties;
}

/** Plan name pill. Plan icons are intentionally gone: the name is the only badge. */
const PlanIcon = ({ plan, ...rest }: PlanIconProps) => {
  const { t } = useTranslation('subscription');

  return (
    <PlanTag
      {...rest}
      label={t(`plans.plan.${plan}.title` as never, { defaultValue: getUnknownPlanTitle(plan) })}
      theme={getPlanTheme(plan)}
    />
  );
};

export default PlanIcon;
