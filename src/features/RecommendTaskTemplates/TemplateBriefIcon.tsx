import { Block, Icon, Image } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import { memo } from 'react';

import { INTEREST_AREAS } from '@/routes/onboarding/config';

import type { TemplateIconSpec } from './resolveTemplateIcon';

export const INTEREST_ICON_MAP = new Map<string, LucideIcon>(
  INTEREST_AREAS.map((a) => [a.key, a.icon]),
);

interface TemplateBriefIconProps {
  spec: TemplateIconSpec;
  tileSize?: number;
}

/** Square tile with secondary fill — used by the recommend card (28) and detail modal (36). */
export const TemplateBriefIcon = memo<TemplateBriefIconProps>(({ spec, tileSize = 28 }) => {
  const glyphSize = Math.round(tileSize * 0.6);
  return (
    <Block
      align={'center'}
      height={tileSize}
      justify={'center'}
      style={{ background: cssVar.colorFillSecondary, flexShrink: 0 }}
      width={tileSize}
    >
      {spec.kind === 'url' ? (
        <Image
          alt={''}
          height={glyphSize}
          src={spec.src}
          style={{ flex: 'none' }}
          width={glyphSize}
        />
      ) : (
        <Icon
          color={cssVar.colorTextSecondary}
          fill={cssVar.colorTextSecondary}
          icon={spec.Comp}
          size={glyphSize}
        />
      )}
    </Block>
  );
});

TemplateBriefIcon.displayName = 'TemplateBriefIcon';
