import * as stylex from '@stylexjs/stylex';

const NARROW = '@media (width <= 1100px)';
const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';
const SPEECH_INLINE = '@container home (width >= 1086px)';

export const styles = stylex.create({
  grid: {
    containerName: 'home',
    containerType: 'inline-size',
    display: 'grid',
    gridTemplateRows: { default: 'auto auto', [NARROW]: 'auto auto auto' },
    gridTemplateColumns: {
      default: 'minmax(0, 1fr) var(--home-rail-track)',
      [NARROW]: '1fr',
    },
    rowGap: 'var(--home-card-gap)',
    columnGap: 'var(--home-column-gap)',
    width: '100%',
  },
  hero: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gridColumnEnd: '-1',
    gridColumnStart: '1',
    gridRowEnd: '2',
    gridRowStart: '1',
    rowGap: '16px',
    columnGap: '16px',
    alignItems: 'end',
    width: { default: 'calc(100% - var(--home-collapsed-offset) * 2)', [NARROW]: '100%' },
    minWidth: 0,
    transition: {
      default: 'transform var(--home-rail-transition) ease-out',
      [REDUCED_MOTION]: 'none',
    },
  },
  heroWithSpeech: {
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [SPEECH_INLINE]: 'minmax(0, 1fr) max-content',
    },
    columnGap: { default: '16px', [SPEECH_INLINE]: 'var(--home-speech-gap)' },
  },
  heroCollapsed: {
    transform: {
      'default': 'translateX(var(--home-collapsed-offset))',
      ':dir(rtl)': 'translateX(calc(-1 * var(--home-collapsed-offset)))',
      [NARROW]: { 'default': 'none', ':dir(rtl)': 'none' },
    },
  },
  header: {
    minWidth: 0,
  },
  speech: {
    '--home-portrait-width': {
      default: 'var(--home-compact-portrait-width)',
      [SPEECH_INLINE]: 'var(--home-full-portrait-width)',
    },
    '--home-portrait-height': {
      default: 'var(--home-compact-portrait-height)',
      [SPEECH_INLINE]: 'var(--home-full-portrait-height)',
    },
    '--home-portrait-overlap': {
      default: 'var(--home-compact-portrait-overlap)',
      [SPEECH_INLINE]: 'var(--home-full-portrait-overlap)',
    },
    'display': 'flex',
    'gridArea': { default: null, [SPEECH_INLINE]: '1 / 2' },
    'rowGap': '16px',
    'columnGap': '16px',
    'alignItems': 'flex-end',
    'alignSelf': { default: null, [SPEECH_INLINE]: 'stretch' },
    'justifySelf': 'end',
    'width': 'max-content',
    'maxWidth': {
      default: '100%',
      [SPEECH_INLINE]: 'calc(100cqw - var(--home-speech-reserved))',
    },
    'minHeight': { default: 'var(--home-compact-portrait-visible)', [SPEECH_INLINE]: 0 },
    'transform': {
      'default': 'translateX(calc(var(--home-collapsed-offset) * 2))',
      ':dir(rtl)': 'translateX(calc(var(--home-collapsed-offset) * -2))',
      [NARROW]: { 'default': 'none', ':dir(rtl)': 'none' },
    },
    'transition': {
      default: 'transform var(--home-rail-transition) ease-out',
      [REDUCED_MOTION]: 'none',
    },
  },
  speechCollapsed: {
    transform: 'none',
  },
  bubbleSlot: {
    width: 'max-content',
    minWidth: 0,
    maxWidth: '100%',
    marginBlockEnd: '4px',
  },
  portrait: {
    pointerEvents: 'none',
    flex: 'none',
    alignSelf: 'stretch',
    width: 'calc(var(--home-portrait-width) + var(--home-portrait-inset))',
  },
  inputArea: {
    position: 'relative',
    minWidth: 0,
  },
  main: {
    position: 'relative',
    gridColumnStart: '1',
    gridRowStart: '2',
    width: '100%',
    minWidth: 0,
    transition: {
      default:
        'transform var(--home-rail-transition) ease-out, width var(--home-rail-transition) ease-out',
      [REDUCED_MOTION]: 'none',
    },
  },
  mainCollapsed: {
    transform: {
      'default': 'translateX(var(--home-collapsed-offset))',
      ':dir(rtl)': 'translateX(calc(-1 * var(--home-collapsed-offset)))',
      [NARROW]: { 'default': 'none', ':dir(rtl)': 'none' },
    },
    width: { default: 'calc(100% + var(--home-collapsed-gain))', [NARROW]: '100%' },
  },
  minimal: {
    width: '100%',
    maxInlineSize: '760px',
    marginInline: 'auto',
    paddingBlockEnd: 'var(--home-minimal-lift)',
  },
  rail: {
    position: 'relative',
    zIndex: 1,
    display: 'flex',
    flexDirection: 'column',
    gridArea: { default: '2 / 2', [NARROW]: '3 / 1' },
    justifySelf: { default: null, [NARROW]: 'end' },
    width: { default: null, [NARROW]: 'min(100%, var(--home-rail-track))' },
    minWidth: 0,
    paddingInlineEnd: 'var(--home-rail-gutter)',
    transform: 'translateX(0)',
    visibility: 'visible',
    opacity: 1,
    transition: {
      default:
        'opacity var(--home-rail-transition) ease-out, transform var(--home-rail-transition) ease-out, visibility 0s linear',
      [REDUCED_MOTION]: 'none',
    },
  },
  railCollapsed: {
    pointerEvents: 'none',
    display: { default: 'flex', [NARROW]: 'none' },
    transform: {
      'default': 'translateX(var(--home-rail-exit))',
      ':dir(rtl)': 'translateX(calc(-1 * var(--home-rail-exit)))',
    },
    visibility: 'hidden',
    opacity: 0,
    transitionDelay: '0s, 0s, var(--home-rail-transition)',
  },
});
