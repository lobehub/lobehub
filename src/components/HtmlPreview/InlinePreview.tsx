import { HtmlPreview } from '@lobehub/ui';
import type { CSSProperties } from 'react';
import { memo } from 'react';

const hideHtmlPreviewActions = () => null;

interface InlineHtmlPreviewProps {
  animated?: boolean;
  className?: string;
  content: string;
  height?: CSSProperties['height'];
  style?: CSSProperties;
  width?: CSSProperties['width'];
}

const InlineHtmlPreview = memo<InlineHtmlPreviewProps>(
  ({ animated, className, content, height = '100%', style, width = '100%' }) => (
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
      {content}
    </HtmlPreview>
  ),
);

InlineHtmlPreview.displayName = 'InlineHtmlPreview';

export default InlineHtmlPreview;
