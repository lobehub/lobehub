'use client';

import type { VerifyEvidenceChapterKind } from '@lobechat/types';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { CLAIM_COLOR } from './styles';

export const ClaimDot = ({ kind }: { kind: VerifyEvidenceChapterKind }) => (
  <span
    aria-hidden
    style={{
      background: CLAIM_COLOR[kind],
      borderRadius: '50%',
      flex: 'none',
      height: 6,
      width: 6,
    }}
  />
);

/**
 * Who said it and what kind of remark it is: a coloured dot (green for the
 * agent's self-check, yellow for a flag) beside a label in the surrounding text
 * colour. The colour sits on the dot only, so the label stays as readable as
 * the text it introduces.
 */
export const ClaimLabel = ({
  kind,
  style,
}: {
  kind: VerifyEvidenceChapterKind;
  style?: CSSProperties;
}) => {
  const { t } = useTranslation('verify');

  return (
    <span
      style={{
        alignItems: 'center',
        display: 'inline-flex',
        flex: 'none',
        fontWeight: 600,
        gap: 6,
        ...style,
      }}
    >
      <ClaimDot kind={kind} />
      {t(`acceptance.video.claim.${kind}`)}
    </span>
  );
};
