'use client';

// oxlint-disable-next-line stylex-migration/no-emotion-styles -- docx-preview page DOM gets no className
import { createStaticStyles, cssVar as cssVarValue } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import Loading from '@/components/Loading/CircleLoading';
import { sx } from '@/styles/sx';

import { collectDocxSections, type DocxSection } from './docxSections';
import PaneFooter from './PaneFooter';

const styles = stylex.create({
  scroll: {
    overflow: 'auto',
    flex: '1',
    backgroundColor: cssVar.colorBgLayout,
    backgroundImage: 'none',
  },
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
});

const fallback = createStaticStyles(({ css }) => ({
  scroll: css`
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
      box-shadow: ${cssVarValue.boxShadowTertiary};
    }
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
    <div {...stylex.props(styles.wrapper)}>
      <div {...sx(styles.scroll, fallback.scroll)} ref={scrollRef}>
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
