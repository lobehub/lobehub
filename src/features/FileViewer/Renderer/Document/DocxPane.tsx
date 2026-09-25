'use client';

import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import Loading from '@/components/Loading/CircleLoading';

import { collectDocxSections, type DocxSection } from './docxSections';
import PaneFooter from './PaneFooter';

const styles = createStaticStyles(({ css }) => ({
  scroll: css`
    overflow: auto;
    flex: 1;
    background: ${cssVar.colorBgLayout};

    /* docx-preview renders fixed-size "pages"; keep them centered with a gap.
       "safe center" falls back to flex-start when the page is wider than the
       pane, so the left edge stays reachable by horizontal scroll. */
    .docx-wrapper {
      display: flex;
      flex-direction: column;
      gap: 12px;
      align-items: safe center;

      padding: 10px;

      background: transparent;
    }

    .docx-wrapper > section.docx {
      margin-block-end: 0;
      border-radius: 4px;
      box-shadow: ${cssVar.boxShadowTertiary};
    }
  `,
  wrapper: css`
    display: flex;
    flex-direction: column;
    height: 100%;
    background: ${cssVar.colorBgContainer};
  `,
}));

interface DocxPaneProps {
  blob: Blob;
  onError: (error: unknown) => void;
}

const DocxPane = memo<DocxPaneProps>(({ blob, onError }) => {
  const [loading, setLoading] = useState(true);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [sections, setSections] = useState<DocxSection[]>([]);
  const [activeSection, setActiveSection] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container) return;

    let disposed = false;

    (async () => {
      try {
        const { renderAsync } = await import('docx-preview');
        if (disposed) return;
        await renderAsync(blob, container);
        if (disposed) return;
        setSections(collectDocxSections(container));
        setActiveSection(0);
        setLoading(false);
      } catch (error) {
        if (!disposed) onError(error);
      }
    })();

    return () => {
      disposed = true;
      setSections([]);
      // renderAsync has no dispose handle — it owns the container's children
      // (including injected <style>), so clearing it is the documented cleanup.
      container.replaceChildren();
    };
  }, [blob, container, onError]);

  // The rendered pages are one long scroll, so the active tab follows the
  // viewport instead of only the last click.
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || sections.length === 0) return;

    const onScroll = () => {
      const top = scroll.getBoundingClientRect().top;
      let next = 0;
      sections.forEach((section, index) => {
        if (section.element.getBoundingClientRect().top - top <= 1) next = index;
      });
      setActiveSection(next);
    };

    scroll.addEventListener('scroll', onScroll, { passive: true });
    return () => scroll.removeEventListener('scroll', onScroll);
  }, [sections]);

  const goToSection = useCallback(
    (key: string) => {
      const section = sections[Number(key)];
      if (!section) return;
      setActiveSection(Number(key));
      section.element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [sections],
  );

  return (
    <div className={styles.wrapper}>
      <div className={styles.scroll} ref={scrollRef}>
        {loading && <Loading />}
        <div ref={setContainer} />
      </div>
      {sections.length > 0 && (
        <PaneFooter
          activeTab={String(activeSection)}
          tabs={sections.map((section, index) => ({
            key: String(index),
            label: section.title,
            title: section.title,
          }))}
          onTabChange={goToSection}
        />
      )}
    </div>
  );
});

DocxPane.displayName = 'DocxPane';

export default DocxPane;
