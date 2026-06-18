'use client';

import Anser from 'anser';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useMemo } from 'react';

const styles = createStaticStyles(({ css }) => ({
  pre: css`
    overflow: auto;

    max-height: 200px;
    margin: 0;
    padding: 8px;
    border-radius: 6px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorText};
    word-break: break-word;
    white-space: pre-wrap;

    background: ${cssVar.colorFillTertiary};
  `,
}));

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
    <pre className={styles.pre}>
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
