import { style } from '@vanilla-extract/css';

const box = {
  alignItems: 'center',
  borderRadius: '6px',
  display: 'inline-flex',
  flexShrink: 0,
  justifyContent: 'center',
  overflow: 'hidden',
} as const;

export const emojiBox = style({
  ...box,
  background: 'var(--lobe-overlay-fill-tertiary, rgba(0, 0, 0, 0.04))',
});

export const image = style({
  ...box,
  objectFit: 'cover',
});

export const textBox = style({
  ...box,
  background: 'var(--lobe-overlay-fill-secondary, rgba(0, 0, 0, 0.06))',
  color: 'var(--lobe-overlay-text-secondary, rgba(0, 0, 0, 0.65))',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
});
