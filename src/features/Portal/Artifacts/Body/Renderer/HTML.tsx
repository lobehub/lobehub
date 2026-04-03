import { sanitizeHTMLContent } from '@lobechat/utils/client';
import { memo, useMemo } from 'react';

interface HTMLRendererProps {
  height?: string;
  htmlContent: string;
  width?: string;
}
const HTMLRenderer = memo<HTMLRendererProps>(({ htmlContent, width = '100%', height = '100%' }) => {
  const sanitizedContent = useMemo(() => sanitizeHTMLContent(htmlContent), [htmlContent]);

  return (
    <iframe
      sandbox=""
      srcDoc={sanitizedContent}
      style={{ border: 'none', height, width }}
      title="html-renderer"
    />
  );
});

export default HTMLRenderer;
