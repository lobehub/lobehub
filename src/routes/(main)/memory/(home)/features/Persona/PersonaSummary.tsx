import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

const styles = stylex.create({
  summary: {
    'position': 'relative',
    'paddingBlock': '16px',
    'paddingInline': '20px',
    'borderRadius': '8px',
    'fontSize': '15px',
    'fontStyle': 'italic',
    'lineHeight': 1.6,
    'color': cssVar.colorText,
    'backgroundColor': cssVar.colorFillQuaternary,
    'backgroundImage': 'none',
    '::before': {
      content: "'\"'",
      position: 'absolute',
      insetBlockStart: '8px',
      insetInlineStart: '12px',
      fontFamily: 'Georgia, serif',
      fontSize: '28px',
      fontStyle: 'normal',
      lineHeight: 1,
      color: cssVar.colorTextQuaternary,
    },
  },
});

interface PersonaSummaryProps {
  children: string;
}

const PersonaSummary = memo<PersonaSummaryProps>(({ children }) => {
  return <div {...stylex.props(styles.summary)}>{children}</div>;
});

export default PersonaSummary;
