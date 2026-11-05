import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { cardMarker } from './markers.stylex';

export const cardStyles = stylex.create({
  actions: {
    position: 'absolute',
    insetBlockStart: '8px',
    insetInlineEnd: '8px',
    borderRadius: cssVar.borderRadiusSM,
    opacity: {
      'default': 0,
      '@media (hover: none)': 1,
      [stylex.when.ancestor(':hover', cardMarker)]: 1,
      [stylex.when.ancestor(':focus-within', cardMarker)]: 1,
    },
    backgroundColor: `color-mix(in srgb, ${cssVar.colorBgContainer} 85%, transparent)`,
    backgroundImage: 'none',
    transition: 'opacity 0.15s',
  },
  avatarRing: {
    position: 'relative',
    overflow: 'hidden',
    display: 'inline-flex',
    borderWidth: '3px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBgContainer,
    borderRadius: '50%',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: `linear-gradient(${cssVar.colorFillTertiary}, ${cssVar.colorFillTertiary})`,
    backgroundClip: 'padding-box',
  },
  avatarRingGroup: {
    borderRadius: cssVar.borderRadiusLG,
  },
  card: {
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    paddingBlockStart: '52px',
    paddingBlockEnd: '16px',
    paddingInline: '12px',
    textAlign: 'center',
    transition: 'transform 0.18s, box-shadow 0.18s, border-color 0.18s',
    transform: { 'default': null, ':hover': 'translateY(-1px)' },
    boxShadow: { 'default': null, ':hover': cssVar.boxShadowTertiary },
  },
  description: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '2',
    width: '100%',
    height: '36px',
    marginBlockStart: '8px',
    fontSize: '12px',
    lineHeight: '18px',
    color: cssVar.colorTextSecondary,
    overflowWrap: 'anywhere',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))',
    gap: '12px',
    width: '100%',
    minWidth: 0,
  },
  link: {
    display: 'block',
    minWidth: 0,
    height: '100%',
    color: 'inherit',
  },
  name: {
    width: '100%',
    marginBlockStart: '8px',
    fontSize: '14px',
    fontWeight: 600,
    lineHeight: '22px',
  },
  owner: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    alignSelf: 'stretch',
    minWidth: 0,
    marginBlockStart: 'auto',
    paddingBlockStart: '12px',
    fontSize: '12px',
    lineHeight: '16px',
    color: cssVar.colorTextTertiary,
  },
  ownerName: {
    overflow: 'hidden',
    minWidth: 0,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  role: {
    overflow: 'hidden',
    maxWidth: '100%',
    paddingInline: '8px',
    borderRadius: '999px',
    fontSize: '12px',
    lineHeight: '22px',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  roleRow: {
    display: 'flex',
    justifyContent: 'center',
    width: '100%',
    height: '22px',
    marginBlockStart: '4px',
  },
  wrapper: {
    position: 'relative',
    minWidth: 0,
    height: '100%',
  },
});

export const coverStyles = stylex.create({
  coverImage: {
    backgroundPosition: 'center',
    backgroundSize: 'cover',
  },
  crosshatch: {
    backgroundImage: `repeating-linear-gradient(45deg, var(--cover-line) 0 1px, transparent 1px 10px), repeating-linear-gradient(-45deg, var(--cover-line) 0 1px, transparent 1px 10px)`,
    backgroundSize: 'auto',
  },
  dots: {},
  grid: {
    backgroundImage: `linear-gradient(var(--cover-faint) 1px, transparent 1px), linear-gradient(90deg, var(--cover-faint) 1px, transparent 1px)`,
    backgroundSize: '16px 16px',
  },
  lines: {
    backgroundImage:
      'repeating-linear-gradient(0deg, var(--cover-faint) 0 1px, transparent 1px 8px)',
    backgroundSize: 'auto',
  },
  rings: {
    backgroundImage:
      'repeating-radial-gradient(circle at 100% 0, var(--cover-line) 0 1px, transparent 1px 10px)',
    backgroundSize: 'auto',
  },
  root: {
    '--cover-ink': `color-mix(in srgb, ${cssVar.colorBgContainer} 30%, transparent)`,
    '--cover-line': `color-mix(in srgb, ${cssVar.colorBgContainer} 22%, transparent)`,
    '--cover-faint': `color-mix(in srgb, ${cssVar.colorBgContainer} 15%, transparent)`,
    'position': 'absolute',
    'insetBlockStart': 0,
    'insetInlineStart': 0,
    'insetInlineEnd': 0,
    'height': '80px',
    'backgroundColor': `color-mix(in srgb, var(--agent-cover, ${cssVar.colorFill}) 72%, ${cssVar.colorBgContainer})`,
    'backgroundImage': 'radial-gradient(var(--cover-ink) 1px, transparent 1.5px)',
    'backgroundSize': '10px 10px',
    'transition': 'background-color 0.3s',
  },
  scales: {
    backgroundImage:
      'radial-gradient(circle at 50% 0, transparent 6px, var(--cover-line) 6px 7px, transparent 7px)',
    backgroundSize: '14px 8px',
  },
  stagger: {
    backgroundImage:
      'radial-gradient(var(--cover-ink) 1.5px, transparent 2px), radial-gradient(var(--cover-ink) 1.5px, transparent 2px)',
    backgroundPosition: '0 0, 8px 8px',
    backgroundSize: '16px 16px',
  },
  stripes: {
    backgroundImage:
      'repeating-linear-gradient(45deg, var(--cover-line) 0 1px, transparent 1px 8px)',
    backgroundSize: 'auto',
  },
});
