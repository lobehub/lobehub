'use client';

import type { VerifyEvidenceChapter } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ClaimDot } from './ClaimLabel';
import { claimsOf, formatVideoClock, formatVideoTime, stepsOf } from './videoTime';

const styles = stylex.create({
  step: {
    cursor: 'pointer',
    display: 'inline-flex',
    gap: '6px',
    alignItems: 'center',
    height: '24px',
    paddingInline: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    fontSize: '12px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
  },
  toggle: {
    cursor: 'pointer',
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    alignSelf: 'flex-start',
    padding: '0',
    borderStyle: 'none',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorTextSecondary },
    backgroundColor: 'transparent',
    backgroundImage: 'none',
  },
  claim: {
    cursor: 'pointer',
    display: 'flex',
    gap: '8px',
    alignItems: 'baseline',
    paddingBlock: '3px',
    paddingInline: '6px',
    borderStyle: 'none',
    borderRadius: cssVar.borderRadiusSM,
    fontSize: '13px',
    color: cssVar.colorText,
    textAlign: 'start',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
  },
  time: {
    flex: 'none',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorTextTertiary,
  },
});

interface VideoClaimListProps {
  chapters: VerifyEvidenceChapter[];
  onSeek: (seconds: number) => void;
}

/**
 * The agent's steps as jump chips, and its claims folded into one line. The
 * timeline dots and captions already surface each claim in place; the list is
 * for reading them all at once, so it waits to be opened.
 */
export const VideoClaimList = ({ chapters, onSeek }: VideoClaimListProps) => {
  const { t } = useTranslation('verify');
  const [open, setOpen] = useState(false);
  const steps = stepsOf(chapters);
  const claims = claimsOf(chapters);
  if (steps.length === 0 && claims.length === 0) return null;

  const checks = claims.filter((claim) => claim.kind === 'check').length;
  const flags = claims.length - checks;

  return (
    <Flexbox gap={6}>
      {steps.length > 0 && (
        <Flexbox horizontal gap={6} style={{ flexWrap: 'wrap' }}>
          {steps.map((step) => (
            <button
              {...stylex.props(styles.step)}
              key={`${step.t}-${step.label}`}
              type={'button'}
              onClick={() => onSeek(step.t)}
            >
              <span {...stylex.props(styles.time)}>{formatVideoClock(step.t)}</span>
              {step.label}
            </button>
          ))}
        </Flexbox>
      )}
      {claims.length > 0 && (
        <button
          aria-expanded={open}
          {...stylex.props(styles.toggle)}
          type={'button'}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon icon={open ? ChevronDown : ChevronRight} size={12} />
          {t('acceptance.video.claimsSummary', { checks, flags })}
        </button>
      )}
      {open &&
        claims.map((claim, index) => (
          <button
            {...stylex.props(styles.claim)}
            key={`${claim.kind}-${claim.t}-${index}`}
            type={'button'}
            onClick={() => onSeek(claim.t)}
          >
            <span style={{ alignSelf: 'center', display: 'inline-flex' }}>
              <ClaimDot kind={claim.kind} />
            </span>
            <span {...stylex.props(styles.time)}>{formatVideoTime(claim.t)}</span>
            <span>{claim.note}</span>
          </button>
        ))}
    </Flexbox>
  );
};
