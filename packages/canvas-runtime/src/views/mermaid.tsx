import { type CSSProperties, memo, useEffect, useId, useRef, useState } from 'react';

import { loadCanvasAddon } from '../addons/load';
import type { CanvasMermaidMount } from '../addons/registry';
import { normalizeCodeText } from '../codeText';
import type { CanvasView } from '../element';

const SERIES = ['blue', 'gold', 'green', 'red', 'purple', 'cyan', 'orange', 'magenta'];

// Same mapping lobe-ui's Mermaid uses for its default theme, so diagrams follow the app theme.
const PELE_THEME = {
  '--pele-accent': 'var(--lobe-color-primary)',
  '--pele-bg': 'var(--lobe-color-bg-container)',
  '--pele-border': 'var(--lobe-color-border)',
  '--pele-critical': 'var(--lobe-color-error)',
  '--pele-error': 'var(--lobe-color-error)',
  '--pele-fg': 'var(--lobe-color-text)',
  '--pele-font': 'var(--lobe-font-family)',
  '--pele-font-mono': 'var(--lobe-font-family-code)',
  '--pele-line': 'var(--lobe-color-text-secondary)',
  '--pele-muted': 'var(--lobe-color-text-description)',
  '--pele-radius': 'var(--lobe-border-radius)',
  '--pele-surface': 'var(--lobe-color-fill-tertiary)',
  '--pele-surface-alt': 'var(--lobe-color-fill-secondary)',
  ...Object.fromEntries(
    SERIES.map((color, index) => [`--pele-series-${index + 1}`, `var(--lobe-${color})`]),
  ),
} as CSSProperties;

const reportDiagramError = (message: string) =>
  window.dispatchEvent(
    new CustomEvent('lobe-canvas-component-error', { detail: { message, tag: 'lobe-mermaid' } }),
  );

const MermaidDiagram = memo<{ source: string }>(({ source }) => {
  const reactId = useId();
  const idPrefix = `lobe-mermaid-${reactId.replaceAll(':', '')}-`;
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    let mounted: CanvasMermaidMount | undefined;
    setError(undefined);

    const fail = (message: string) => {
      if (!live) return;
      setError(message);
      reportDiagramError(message);
    };

    loadCanvasAddon('mermaid')
      .then((addon) => {
        if (!live || !container.current) return;
        mounted = addon.mount(container.current, source, idPrefix);
        if (mounted.error) fail(mounted.error);
      })
      .catch((reason: unknown) => fail(reason instanceof Error ? reason.message : String(reason)));

    return () => {
      live = false;
      mounted?.destroy();
    };
  }, [source, idPrefix]);

  if (error)
    return (
      <pre data-lobe-canvas-mermaid-fallback="">
        <code>{source}</code>
      </pre>
    );

  return <div data-lobe-canvas-mermaid="" ref={container} style={PELE_THEME} />;
});

MermaidDiagram.displayName = 'CanvasMermaidDiagram';

export const mermaidViews: Record<string, CanvasView> = {
  'lobe-mermaid': ({ text }) => <MermaidDiagram source={normalizeCodeText(text)} />,
};
