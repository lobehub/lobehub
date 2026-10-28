// @lobehub/ui HtmlPreviewIframe without a `sandbox` override renders in its default
// sandbox ("allow-scripts allow-forms allow-modals"), an opaque origin.
import { Highlighter, HtmlPreviewIframe, Skeleton } from '@lobehub/ui';
import { useMemo } from 'react';

import { buildVisualDocument } from './buildDocument';
import { parseVisual } from './schema';

const VisualRender = ({ isGenerating, source }: { isGenerating: boolean; source: string }) => {
  const parsed = useMemo(() => parseVisual(source.trim()), [source]);
  const document = useMemo(
    () => (parsed.success ? buildVisualDocument(parsed.blocks) : null),
    [parsed],
  );

  if (!document) {
    if (isGenerating) return <Skeleton height={72} />;
    return <Highlighter language={'json'}>{source}</Highlighter>;
  }

  return (
    <HtmlPreviewIframe
      background={'transparent'}
      content={document}
      defaultHeight={48}
      title={'visual'}
    />
  );
};

export default VisualRender;
