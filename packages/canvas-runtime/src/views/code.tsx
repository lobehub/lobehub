import { CopyButton } from '@lobehub/ui';
import { memo, useEffect, useState } from 'react';

import { loadCanvasAddon } from '../addons/load';
import { normalizeCodeText } from '../codeText';
import type { CanvasView } from '../element';

const CodeBlock = memo<{ code: string; language?: string }>(({ code, language }) => {
  const [html, setHtml] = useState<string>();

  useEffect(() => {
    let live = true;
    setHtml(undefined);
    loadCanvasAddon('highlight')
      .then((addon) => addon.highlight(code, language))
      .then((next) => {
        if (live) setHtml(next);
      })
      .catch((error) => console.error('[lobe-canvas] code highlighting failed', error));
    return () => {
      live = false;
    };
  }, [code, language]);

  return (
    <div data-lobe-canvas-code="">
      <div data-lobe-canvas-code-header="">
        <span>{language || 'text'}</span>
        <CopyButton content={code} size={'small'} />
      </div>
      {html ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre>
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
});

CodeBlock.displayName = 'CanvasCodeBlock';

export const codeViews: Record<string, CanvasView> = {
  'lobe-code': ({ props, text }) => (
    <CodeBlock code={normalizeCodeText(text)} language={props.language} />
  ),
};
