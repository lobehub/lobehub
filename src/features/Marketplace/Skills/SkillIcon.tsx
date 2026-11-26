import { Center, Icon } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { memo } from 'react';

import IconTile from './IconTile';
import { getSkillCategoryStyle } from './skillCategoryStyle';

/**
 * A skill's icon, drawn from its category: the category's color with its lucide
 * glyph in white. A skill without a known category (an installed one the library
 * lists without it) gets the skill glyph on the plain Surface tile.
 */
const SkillIcon = memo<{ category?: string | null; size: number }>(({ category, size }) => {
  const style = getSkillCategoryStyle(category);
  const glyph = Math.round(size * 0.5);

  if (!style)
    return (
      <IconTile size={size}>
        <SkillsIcon color={cssVar.colorText} size={glyph} />
      </IconTile>
    );

  return (
    <Center
      flex={'none'}
      height={size}
      style={{ background: style.tile, borderRadius: Math.round(size * 0.25) }}
      width={size}
    >
      <Icon color={'#fff'} icon={style.icon} size={glyph} />
    </Center>
  );
});

SkillIcon.displayName = 'MarketSkillIcon';

export default SkillIcon;
