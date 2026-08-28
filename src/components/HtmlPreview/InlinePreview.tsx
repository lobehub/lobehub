import { HtmlPreview } from '@lobehub/ui';
import type { CSSProperties } from 'react';
import { memo, useMemo } from 'react';

import { applyHtmlPreviewBaseUrl } from './applyBaseUrl';

const hideHtmlPreviewActions = () => null;

interface InlineHtmlPreviewProps {
  animated?: boolean;
  baseUrl?: string;
  className?: string;
  content: string;
  height?: CSSProperties['height'];
  style?: CSSProperties;
  width?: CSSProperties['width'];
}

const InlineHtmlPreview = memo<InlineHtmlPreviewProps>(
  ({ animated, baseUrl, className, content, height = '100%', style, width = '100%' }) => {
    const previewContent = useMemo(
      () => applyHtmlPreviewBaseUrl(content, baseUrl),
      [baseUrl, content],
    );

    return (
      <HtmlPreview
        actionsRender={hideHtmlPreviewActions}
        animated={animated}
        className={className}
        copyable={false}
        downloadable={false}
        shadow={false}
        style={{ height, minHeight: 0, overflow: 'hidden', width, ...style }}
        variant={'borderless'}
        styles={{
          content: { height: '100%' },
          iframe: { height: '100%' },
        }}
      >
        {previewContent}
      </HtmlPreview>
    );
  },
);

InlineHtmlPreview.displayName = 'InlineHtmlPreview';

export default InlineHtmlPreview;
