'use client';

import { Flexbox } from '@lobehub/ui';
import { css, cx } from 'antd-style';
import { memo } from 'react';

const container = css`
  position: relative;
  overflow: hidden;
  border-radius: 4px;
`;

const content = css`
  position: absolute;
  inset-block: -1px;
  inset-inline-start: -1px;

  width: calc(100% + 2px);
  height: calc(100% + 2px);
  border: 0;
`;

interface MSDocViewerProps {
  fileId: string;
  url: string | null;
}

const MSDocViewer = memo<MSDocViewerProps>(({ url }) => {
  if (!url) return null;

  return (
    <Flexbox className={cx(container)} height={'100%'} id="msdoc-renderer" width={'100%'}>
      <iframe
        className={cx(content)}
        id="msdoc-iframe"
        src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`}
        title="msdoc-iframe"
      />
    </Flexbox>
  );
});

export default MSDocViewer;
