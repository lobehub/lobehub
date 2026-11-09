'use client';

import { cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import { ChevronRight } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';

interface FoldedTextProps {
  /** Shown before the text on the collapsed line, e.g. "判定依据". */
  label?: ReactNode;
  /** Render the text in the secondary color, for supporting prose. */
  secondary?: boolean;
  text: string;
}

/**
 * Secondary prose under a check, folded to one line until the reader asks for
 * it. A check expanded to judge it was a wall of paragraphs — the verdict, the
 * verifier's reasoning and the builder's argument all at full length — so the
 * supporting text stays one line and opens in place.
 */
const FoldedText = memo<FoldedTextProps>(({ label, secondary, text }) => {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((value) => !value);

  return (
    <Flexbox
      horizontal
      align={'flex-start'}
      aria-expanded={open}
      gap={4}
      role={'button'}
      style={{ cursor: 'pointer', minWidth: 0, width: '100%' }}
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        toggle();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggle();
        }
      }}
    >
      <Icon
        color={cssVar.colorTextQuaternary}
        icon={ChevronRight}
        size={12}
        style={{
          flex: 'none',
          marginBlockStart: 4,
          transform: open ? 'rotate(90deg)' : 'none',
          transition: '0.2s',
        }}
      />
      <Text
        ellipsis={!open}
        fontSize={12}
        style={{ flex: 1, minWidth: 0, whiteSpace: open ? 'pre-wrap' : undefined }}
        type={secondary ? 'secondary' : undefined}
      >
        {label && (
          <Text as={'span'} fontSize={11} style={{ marginInlineEnd: 6 }} type={'secondary'}>
            {label}
          </Text>
        )}
        {text}
      </Text>
    </Flexbox>
  );
});

FoldedText.displayName = 'AcceptanceFoldedText';

export default FoldedText;
