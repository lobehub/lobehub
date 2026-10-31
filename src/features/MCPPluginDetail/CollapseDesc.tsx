import { Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type PropsWithChildren } from 'react';
import { memo } from 'react';

// The cascade here kept margin-block at `4px 0` even when hidden (an
// `!important` on `desc` outranked `hideDesc`), so hiding only collapses the
// height and opacity.
const styles = stylex.create({
  desc: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 1,
    height: '28px',
    marginBlockStart: '4px',
    marginBlockEnd: 0,
    fontSize: '14px',
    lineHeight: '28px',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    transition: `margin-block-start 0.3s ${cssVar.motionEaseInOut}, height 0.3s ${cssVar.motionEaseInOut}, opacity 0.2s ${cssVar.motionEaseInOut}`,
  },
  hideDesc: {
    height: 0,
    opacity: 0,
  },
});

const CollapseDesc = memo<PropsWithChildren<{ hide?: boolean }>>(({ children, hide }) => {
  return (
    <Text as={'p'} className={stylex.props(styles.desc, hide && styles.hideDesc).className}>
      {children}
    </Text>
  );
});

export default CollapseDesc;
