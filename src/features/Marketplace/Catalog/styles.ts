import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';

/**
 * The Codex catalog geometry, shared with the installed list
 * (`Settings/skill/features/SkillList` page groups): a 16px group heading, then
 * a two-column grid of borderless rows; groups are separated by 32px of
 * whitespace, not rules.
 */
export const catalogStyles = stylex.create({
  grid: {
    display: 'grid',
    gridTemplateColumns: { default: 'repeat(2, minmax(0, 1fr))', [media.lg]: 'minmax(0, 1fr)' },
    columnGap: '16px',
    rowGap: '4px',
  },
  section: { display: 'flex', flexDirection: 'column', gap: '12px' },
  sections: {
    display: 'flex',
    flexDirection: 'column',
    gap: '32px',
    paddingBlockStart: '8px',
  },
});
