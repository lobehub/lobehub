import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { StarIcon } from 'lucide-react';

import { sx } from '@/styles/sx';

import { artboardTokens } from '../tokens.stylex';
import { recommendBadge } from './boardLabelLayout';

const styles = stylex.create({
  badge: {
    alignItems: 'center',
    backgroundColor: cssVar.colorBgContainer,
    borderRadius: '50%',
    boxShadow: `0 0 0 1px color-mix(in srgb, ${artboardTokens.recommendation} 40%, transparent), 0 1px 3px ${cssVar.colorFillSecondary}`,
    color: artboardTokens.recommendation,
    display: 'flex',
    justifyContent: 'center',
    pointerEvents: 'none',
    position: 'absolute',
    transformOrigin: '100% 0',
    zIndex: 2,
  },
});

interface RecommendBadgeProps {
  k: number;
  label: string;
  width: number;
}

const RecommendBadge = ({ k, label, width }: RecommendBadgeProps) => {
  const badge = recommendBadge(width * k);
  if (!badge) return null;
  return (
    <span
      aria-label={label}
      role="img"
      {...sx(styles.badge, {
        height: badge.size,
        right: badge.inset / k,
        top: badge.inset / k,
        transform: `scale(${1 / k})`,
        width: badge.size,
      })}
    >
      <StarIcon fill="currentColor" size={badge.icon} strokeWidth={1.5} />
    </span>
  );
};

export default RecommendBadge;
