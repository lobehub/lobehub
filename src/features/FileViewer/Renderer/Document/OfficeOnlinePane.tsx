'use client';

import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

const styles = stylex.create({
  container: { position: 'relative', overflow: 'hidden', borderRadius: '4px' },
  frame: {
    position: 'absolute',
    insetBlock: '-1px',
    insetInlineStart: '-1px',
    width: 'calc(100% + 2px)',
    height: 'calc(100% + 2px)',
    borderStyle: 'none',
  },
});

interface OfficeOnlinePaneProps {
  /** Must be publicly fetchable — Microsoft's service downloads it server-side. */
  url: string;
}

/**
 * Last-resort preview for legacy binary office formats (.doc / .ppt / .xls /
 * .odt), which no in-app renderer can parse. The file URL is handed to
 * Microsoft's embed service, so this only runs for uploaded files that already
 * carry a remote URL — never for a device's local file.
 */
const OfficeOnlinePane = memo<OfficeOnlinePaneProps>(({ url }) => (
  <Flexbox
    className={stylex.props(styles.container).className}
    height={'100%'}
    id="msdoc-renderer"
    width={'100%'}
  >
    <iframe
      {...stylex.props(styles.frame)}
      id="msdoc-iframe"
      src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`}
      title="msdoc-iframe"
    />
  </Flexbox>
));

OfficeOnlinePane.displayName = 'OfficeOnlinePane';

export default OfficeOnlinePane;
