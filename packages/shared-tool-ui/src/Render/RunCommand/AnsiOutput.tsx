'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import Anser from 'anser';
import { memo, useMemo } from 'react';

const styles = stylex.create({
  pre: {
    overflow: 'auto',
    maxHeight: '200px',
    margin: '0',
    padding: '8px',
    borderRadius: '6px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    lineHeight: 1.6,
    color: cssVar.colorText,
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
});

interface AnsiOutputProps {
  text: string;
}

const AnsiOutput = memo<AnsiOutputProps>(({ text }) => {
  const segments = useMemo(
    () =>
      Anser.ansiToJson(text, {
        json: true,
        remove_empty: true,
        use_classes: false,
      }),
    [text],
  );

  return (
    <pre {...stylex.props(styles.pre)}>
      {segments.map((seg, i) => {
        const decorations = seg.decorations ?? [];
        const isDim = decorations.includes('dim');
        const isBold = decorations.includes('bold');
        const isItalic = decorations.includes('italic');
        const isUnderline = decorations.includes('underline');
        const isStrike = decorations.includes('strikethrough');

        return (
          <span
            key={i}
            style={{
              background: seg.bg ? `rgb(${seg.bg})` : undefined,
              color: seg.fg ? `rgb(${seg.fg})` : undefined,
              fontStyle: isItalic ? 'italic' : undefined,
              fontWeight: isBold ? 600 : undefined,
              opacity: isDim ? 0.6 : undefined,
              textDecoration:
                [isUnderline && 'underline', isStrike && 'line-through']
                  .filter(Boolean)
                  .join(' ') || undefined,
            }}
          >
            {seg.content}
          </span>
        );
      })}
    </pre>
  );
});

AnsiOutput.displayName = 'AnsiOutput';

export default AnsiOutput;
