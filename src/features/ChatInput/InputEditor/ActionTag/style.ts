import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

// `.selected` is added by the editor's selection observer, not by React, so it is matched
// as a same-element class.
const SELECTED = ':is(.selected)';

export const styles = stylex.create({
  actionTag: {
    cursor: 'default',
    userSelect: 'none',
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    // TAG_MARGIN_INLINE_END (../constants) — StyleX cannot fold an imported constant.
    marginInlineEnd: '4px',
    paddingInline: '2px',
  },
  actionTagLabel: { fontWeight: 500 },
  agentSkillTag: {
    color: cssVar.colorSuccess,
    borderRadius: { default: null, [SELECTED]: cssVar.borderRadius },
    outlineStyle: { default: null, [SELECTED]: 'solid' },
    outlineWidth: { default: null, [SELECTED]: '2px' },
    outlineColor: { default: null, [SELECTED]: cssVar.colorSuccess },
    outlineOffset: { default: null, [SELECTED]: '1px' },
  },
  clickable: {
    cursor: 'pointer',
    borderRadius: cssVar.borderRadius,
    transition: 'background 0.2s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  commandTag: {
    color: cssVar.purple,
    borderRadius: { default: null, [SELECTED]: cssVar.borderRadius },
    outlineStyle: { default: null, [SELECTED]: 'solid' },
    outlineWidth: { default: null, [SELECTED]: '2px' },
    outlineColor: { default: null, [SELECTED]: cssVar.purple },
    outlineOffset: { default: null, [SELECTED]: '1px' },
  },
  projectSkillTag: {
    color: cssVar.colorSuccess,
    borderRadius: { default: null, [SELECTED]: cssVar.borderRadius },
    outlineStyle: { default: null, [SELECTED]: 'solid' },
    outlineWidth: { default: null, [SELECTED]: '2px' },
    outlineColor: { default: null, [SELECTED]: cssVar.colorSuccess },
    outlineOffset: { default: null, [SELECTED]: '1px' },
  },
  skillTag: {
    color: cssVar.colorSuccess,
    borderRadius: { default: null, [SELECTED]: cssVar.borderRadius },
    outlineStyle: { default: null, [SELECTED]: 'solid' },
    outlineWidth: { default: null, [SELECTED]: '2px' },
    outlineColor: { default: null, [SELECTED]: cssVar.colorSuccess },
    outlineOffset: { default: null, [SELECTED]: '1px' },
  },
  toolTag: {
    color: cssVar.colorInfo,
    borderRadius: { default: null, [SELECTED]: cssVar.borderRadius },
    outlineStyle: { default: null, [SELECTED]: 'solid' },
    outlineWidth: { default: null, [SELECTED]: '2px' },
    outlineColor: { default: null, [SELECTED]: cssVar.colorInfo },
    outlineOffset: { default: null, [SELECTED]: '1px' },
  },
});
