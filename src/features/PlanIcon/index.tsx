import { Plans } from '@lobechat/types';
import { Center, Flexbox, Tag } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Atom, Box, CircleSlash, Crown, Gem, Rocket, Sparkle, Zap } from 'lucide-react';
import { type CSSProperties, type MouseEvent } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

export const themes = {
  [Plans.Free]: {
    icon: CircleSlash,
    theme: {
      background: undefined,
      color: undefined,
    },
  },
  [Plans.Hobby]: {
    icon: Box,
    theme: {
      background: 'linear-gradient(45deg, #21B2EE, #2271ED)',
      color: '#E5F8FF',
    },
  },
  [Plans.Starter]: {
    icon: Sparkle,
    theme: {
      background: 'linear-gradient(45deg, #C57948, #803718)',
      color: '#FFC385',
    },
  },
  [Plans.Premium]: {
    icon: Zap,
    theme: {
      background: 'linear-gradient(45deg, #A5B4C2, #606E7B)',
      color: '#FCFDFF',
    },
  },
  [Plans.Ultimate]: {
    icon: Atom,
    theme: {
      background: 'linear-gradient(45deg, #F7A82F, #BB7227)',
      color: '#FCFA6E',
    },
  },
  [Plans.Plus]: {
    icon: Rocket,
    theme: {
      background: 'linear-gradient(45deg, #8B5CF6, #5B21B6)',
      color: '#EDE9FE',
    },
  },
  [Plans.Pro]: {
    icon: Crown,
    theme: {
      background: 'linear-gradient(45deg, #10B981, #047857)',
      color: '#D1FAE5',
    },
  },
  [Plans.Max]: {
    icon: Gem,
    theme: {
      background: 'linear-gradient(45deg, #374151, #111827)',
      color: '#FDE68A',
    },
  },
} satisfies Record<Plans, unknown>;

const styles = stylex.create({
  icon: { flex: 'none', boxShadow: `0 0 0 1px ${cssVar.colorFillSecondary}` },
});

const getPlanIconMetrics = (size: number) => ({
  glyphSize: Math.max(12, Math.round(size / 2)),
  radius: Math.max(8, Math.round(size / 3)),
});

interface PlanIconProps {
  className?: string;
  mono?: boolean;
  onClick?: (e: MouseEvent) => void;
  plan: Plans;
  size?: number;
  style?: CSSProperties;
  type?: 'icon' | 'tag' | 'combine';
}

const PlanIcon = memo<PlanIconProps>(
  ({ type = 'icon', plan, size = 36, mono, style, className, onClick }) => {
    const { icon: IconComponent, theme } = themes[plan];
    const { t } = useTranslation('subscription');
    const isTag = type === 'tag';
    const isCombine = type === 'combine';
    const isFree = plan === Plans.Free;
    const { glyphSize, radius } = getPlanIconMetrics(size);

    if (isTag) {
      return (
        <Tag
          className={className}
          variant={'filled'}
          style={{
            ...(theme || { background: cssVar.colorFillSecondary, color: cssVar.colorText }),
            border: 'none',
            borderRadius: 12,
            cursor: 'pointer',
            flex: 'none',
            margin: 0,
            ...style,
          }}
          onClick={onClick}
        >
          {t(`plans.plan.${plan}.title`)}
        </Tag>
      );
    }

    const iconStyle = {
      ...(mono
        ? null
        : {
            ...theme,
            border: isFree ? undefined : `2px solid ${theme.color}`,
          }),
      alignItems: 'center',
      borderRadius: radius,
      display: 'flex',
      justifyContent: 'center',
      lineHeight: 0,
      ...style,
    } satisfies CSSProperties;

    const iconContent = (
      <Center
        className={stylex.props(styles.icon).className}
        height={size}
        style={iconStyle}
        width={size}
        onClick={onClick}
      >
        <IconComponent color={mono ? undefined : theme.color} size={glyphSize} />
      </Center>
    );

    if (isCombine) {
      return (
        <Flexbox horizontal align={'center'} gap={8}>
          {iconContent}
          <span>{t(`plans.plan.${plan}.title`)}</span>
        </Flexbox>
      );
    }

    return iconContent;
  },
);

export default PlanIcon;
