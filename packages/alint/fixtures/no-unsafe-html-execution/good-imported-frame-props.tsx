// The iframe's srcDoc and sandbox come from a sibling helper. Nothing in this file
// restores `allow-same-origin`, so there is no visible unsafe frame.
import { useMemo, useRef } from 'react';

import { getSvgFrameProps, rasterizeSvg } from './svgDocument';

const SVGRenderer = ({ content }: { content: string }) => {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const frameProps = useMemo(() => getSvgFrameProps(content), [content]);

  const copyPng = async () => {
    const frame = frameRef.current;
    const png = await rasterizeSvg(content, {
      height: frame?.clientHeight || 600,
      width: frame?.clientWidth || 800,
    });
    await navigator.clipboard.writeText(png);
  };

  return (
    <div style={{ height: '100%', position: 'relative' }}>
      <iframe
        ref={frameRef}
        style={{ border: 'none', width: '100%' }}
        title="svg"
        {...frameProps}
      />
      <button type="button" onClick={copyPng}>
        Copy
      </button>
    </div>
  );
};

export default SVGRenderer;
