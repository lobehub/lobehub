import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { splitQueryHighlightSegments } from '../utils/highlightSegments';

const styles = stylex.create({
  mark: {
    backgroundColor: cssVar.colorWarningBgHover,
    borderRadius: 2,
    color: cssVar.colorText,
  },
});

interface HighlightedTextProps {
  query: string;
  text: string;
}

const HighlightedText = memo<HighlightedTextProps>(({ query, text }) => (
  <>
    {splitQueryHighlightSegments(text, query).map((segment, index) =>
      segment.match ? (
        <mark key={index} {...stylex.props(styles.mark)}>
          {segment.text}
        </mark>
      ) : (
        segment.text
      ),
    )}
  </>
));

HighlightedText.displayName = 'CommandMenuHighlightedText';

export default HighlightedText;
