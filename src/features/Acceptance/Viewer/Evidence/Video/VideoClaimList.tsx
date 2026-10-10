'use client';

import type { VerifyEvidenceChapter } from '@lobechat/types';
import { createStaticStyles, cssVar, Flexbox, Icon } from '@lobehub/ui';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ClaimDot } from './ClaimLabel';
import { claimsOf, formatVideoClock, formatVideoTime, stepsOf } from './videoTime';

const styles = createStaticStyles(({ css }) => ({
  step: css`
    cursor: pointer;

    display: inline-flex;
    gap: 6px;
    align-items: center;

    height: 24px;
    padding-inline: 8px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: transparent;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  toggle: css`
    cursor: pointer;

    display: inline-flex;
    gap: 4px;
    align-items: center;
    align-self: flex-start;

    padding: 0;
    border: none;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};

    background: none;

    &:hover {
      color: ${cssVar.colorTextSecondary};
    }
  `,
  claim: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: baseline;

    padding-block: 3px;
    padding-inline: 6px;
    border: none;
    border-radius: ${cssVar.borderRadiusSM};

    font-size: 13px;
    color: ${cssVar.colorText};
    text-align: start;

    background: transparent;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  time: css`
    flex: none;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
}));

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
              className={styles.step}
              key={`${step.t}-${step.label}`}
              type={'button'}
              onClick={() => onSeek(step.t)}
            >
              <span className={styles.time}>{formatVideoClock(step.t)}</span>
              {step.label}
            </button>
          ))}
        </Flexbox>
      )}
      {claims.length > 0 && (
        <button
          aria-expanded={open}
          className={styles.toggle}
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
            className={styles.claim}
            key={`${claim.kind}-${claim.t}-${index}`}
            type={'button'}
            onClick={() => onSeek(claim.t)}
          >
            <span style={{ alignSelf: 'center', display: 'inline-flex' }}>
              <ClaimDot kind={claim.kind} />
            </span>
            <span className={styles.time}>{formatVideoTime(claim.t)}</span>
            <span>{claim.note}</span>
          </button>
        ))}
    </Flexbox>
  );
};
