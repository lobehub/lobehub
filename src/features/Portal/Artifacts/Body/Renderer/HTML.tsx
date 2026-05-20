import { HtmlPreview } from '@lobehub/ui';
import { memo } from 'react';

interface HTMLRendererProps {
  animated?: boolean;
  height?: string;
  htmlContent: string;
  width?: string;
}

const hideHtmlPreviewActions = () => null;

const HTMLRenderer = memo<HTMLRendererProps>(
  ({ animated, htmlContent, width = '100%', height = '100%' }) => {
    return (
      <HtmlPreview
        actionsRender={hideHtmlPreviewActions}
        animated={animated}
        copyable={false}
        downloadable={false}
        shadow={false}
        style={{ height, minHeight: 0, overflow: 'hidden', width }}
        variant={'borderless'}
        styles={{
          content: { height: '100%' },
          iframe: { height: '100%' },
        }}
      >
        {htmlContent}
      </HtmlPreview>
    );
  },
);

export default HTMLRenderer;
