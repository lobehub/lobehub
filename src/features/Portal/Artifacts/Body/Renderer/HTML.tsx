import { memo } from 'react';

import { InlineHtmlPreview } from '@/components/HtmlPreview';

interface HTMLRendererProps {
  animated?: boolean;
  height?: string;
  htmlContent: string;
  width?: string;
}

const HTMLRenderer = memo<HTMLRendererProps>(
  ({ animated, htmlContent, width = '100%', height = '100%' }) => {
    return (
      <InlineHtmlPreview animated={animated} content={htmlContent} height={height} width={width} />
    );
  },
);

export default HTMLRenderer;
