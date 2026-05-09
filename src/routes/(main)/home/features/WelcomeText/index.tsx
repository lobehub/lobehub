import { Flexbox } from '@lobehub/ui';
import { LoadingDots } from '@lobehub/ui/chat';
import { createStaticStyles, cssVar } from 'antd-style';
import { shuffle } from 'es-toolkit/compat';
import { memo, type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useHomeDailyBrief } from '@/hooks/useHomeDailyBrief';
import { useStableNavigate } from '@/hooks/useStableNavigate';

interface LinkSpan {
  end: number;
  href: string;
  start: number;
  text: string;
}

interface ParsedSentence {
  /** Pre-computed markdown links (from `[label](url)`), positioned in `plain`. */
  links: LinkSpan[];
  /** Plain text without any markdown syntax — what the typewriter types. */
  plain: string;
}

const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;

// Pre-strip markdown bold (legacy prompt format) so the typewriter doesn't
// emit literal asterisks if a generation slips through with `**X**` style.
const stripBold = (text: string): string => text.replaceAll('**', '');

/**
 * Parse a welcome string with markdown link syntax into:
 * - `plain`: just the human-readable text (link labels appear inline)
 * - `links`: where each link sits inside `plain` + its href
 */
const parseSentence = (raw: string): ParsedSentence => {
  const cleaned = stripBold(raw);
  const links: LinkSpan[] = [];
  let plain = '';
  MARKDOWN_LINK_RE.lastIndex = 0;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKDOWN_LINK_RE.exec(cleaned)) !== null) {
    plain += cleaned.slice(lastIndex, m.index);
    const start = plain.length;
    plain += m[1];
    links.push({ end: plain.length, href: m[2], start, text: m[1] });
    lastIndex = m.index + m[0].length;
  }
  plain += cleaned.slice(lastIndex);
  return { links, plain };
};

interface AutoLinkPattern {
  build: (match: string) => string;
  regex: RegExp;
}

// Bare references the model might emit without the markdown link form.
// Used as a fallback so e.g. plain "LOBE-8516" inside the welcome still
// becomes clickable.
const AUTO_LINK_PATTERNS: AutoLinkPattern[] = [
  {
    build: (match) => `https://linear.app/lobehub/issue/${match}`,
    regex: /LOBE-\d+/g,
  },
  {
    build: (match) => `https://github.com/lobehub/lobehub/issues/${match.slice(1)}`,
    regex: /#\d+/g,
  },
];

// "Highlighter underline" trick borrowed from builtin-tool Inspector argument
// chunks (see `highlightTextStyles.primary` in `@/styles/text`): a linear
// gradient paints a thin tinted bar at the bottom of each character box,
// instead of `text-decoration: underline`.
const linkStyles = createStaticStyles(({ css, cssVar }) => ({
  link: css`
    padding-block-end: 1px;
    color: ${cssVar.colorText};
    text-decoration: none;
    background: linear-gradient(to top, ${cssVar.colorPrimaryBgHover} 30%, transparent 30%);
  `,
}));

const isExternal = (href: string): boolean => /^https?:\/\//i.test(href);

interface BriefLinkProps {
  children: ReactNode;
  href: string;
}

/**
 * In-app SPA navigation for relative URLs (so clicks don't reload the whole
 * SPA in a new tab); external URLs open in a new tab.
 */
const BriefLink = memo<BriefLinkProps>(({ href, children }) => {
  const navigate = useStableNavigate();

  if (isExternal(href)) {
    return (
      <a className={linkStyles.link} href={href} rel="noopener noreferrer" target="_blank">
        {children}
      </a>
    );
  }

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Honor modifier keys (cmd/ctrl-click → new tab, middle-click already
    // bypasses onClick because it triggers `auxclick`).
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    navigate(href);
  };

  return (
    <a className={linkStyles.link} href={href} onClick={onClick}>
      {children}
    </a>
  );
});

/**
 * Render `plain` with the embedded markdown links applied + auto-detect
 * Linear / GitHub references that slipped through unwrapped.
 */
const renderWithLinks = (plain: string, embeddedLinks: LinkSpan[]): ReactNode[] => {
  const matches: LinkSpan[] = [...embeddedLinks];
  for (const { regex, build } of AUTO_LINK_PATTERNS) {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(plain)) !== null) {
      matches.push({
        end: m.index + m[0].length,
        href: build(m[0]),
        start: m.index,
        text: m[0],
      });
    }
  }
  if (matches.length === 0) return [plain];

  // Drop overlaps; embedded links win because they were inserted first.
  matches.sort((a, b) => a.start - b.start || a.end - b.end);
  const accepted: LinkSpan[] = [];
  let lastEnd = 0;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      accepted.push(m);
      lastEnd = m.end;
    }
  }

  const out: ReactNode[] = [];
  let cursor = 0;
  for (const [i, m] of accepted.entries()) {
    if (m.start > cursor) out.push(plain.slice(cursor, m.start));
    out.push(
      <BriefLink href={m.href} key={`${m.start}-${i}`}>
        {m.text}
      </BriefLink>,
    );
    cursor = m.end;
  }
  if (cursor < plain.length) out.push(plain.slice(cursor));
  return out;
};

// All timings in milliseconds.
const TYPING_INTERVAL_MS = 21; // ms per character (≈1.5× faster than 32ms)
const PAUSE_DURATION_MS = 30_000;

interface DailyTypewriterProps {
  onSentenceComplete: () => void;
  /**
   * Index of the sentence currently being typed. Controlled by the parent
   * (via `useHomeDailyBrief.currentIndex`) so InputArea and WelcomeText
   * always agree on which pair is "current", even across remounts.
   */
  sentenceIndex: number;
  sentences: ParsedSentence[];
}

/**
 * Controlled typewriter: type → pause (links rendered) → call
 * `onSentenceComplete` to ask the parent to advance, then re-type when
 * `sentenceIndex` flips. Supports real `\n` line breaks via
 * `white-space: pre-wrap`.
 */
const DailyTypewriter = memo<DailyTypewriterProps>(
  ({ sentences, sentenceIndex, onSentenceComplete }) => {
    const [partial, setPartial] = useState('');
    const [phase, setPhase] = useState<'typing' | 'pause'>('typing');
    const [charIndex, setCharIndex] = useState(0);

    const onSentenceCompleteRef = useRef(onSentenceComplete);
    useEffect(() => {
      onSentenceCompleteRef.current = onSentenceComplete;
    }, [onSentenceComplete]);

    // Reset typing state when the controlled `sentenceIndex` changes (i.e.
    // remount, or after `advance()` flips the shared external index) and
    // when the sentence list itself is replaced by a new SWR payload.
    useEffect(() => {
      setPartial('');
      setCharIndex(0);
      setPhase('typing');
    }, [sentenceIndex, sentences]);

    useEffect(() => {
      if (sentences.length === 0) return;
      const current = sentences[sentenceIndex % sentences.length].plain;
      let timer: ReturnType<typeof setTimeout> | undefined;

      switch (phase) {
        case 'typing': {
          if (charIndex < current.length) {
            timer = setTimeout(() => {
              setPartial(current.slice(0, charIndex + 1));
              setCharIndex((c) => c + 1);
            }, TYPING_INTERVAL_MS);
          } else {
            setPhase('pause');
          }
          break;
        }
        case 'pause': {
          timer = setTimeout(() => {
            // Just nudge the parent — the new `sentenceIndex` prop will
            // flow back in and the reset effect above will re-arm typing
            // for the next sentence. Single source of truth.
            onSentenceCompleteRef.current();
          }, PAUSE_DURATION_MS);
          break;
        }
      }

      return () => {
        if (timer) clearTimeout(timer);
      };
    }, [phase, charIndex, sentenceIndex, sentences]);

    const isPaused = phase === 'pause';
    const showCursor = !isPaused;
    const currentSentence = sentences[sentenceIndex % sentences.length];

    return (
      <Flexbox
        style={{
          fontSize: 16,
          // Strict 2-line height so the layout never jumps between empty,
          // single-line, and full sentences. The typewriter pre-fills the
          // box so cycling between sentences also doesn't reflow.
          height: '3.2em',
          lineHeight: 1.6,
          // Clip the rare 3-line generation rather than push the layout.
          overflow: 'hidden',
          paddingInlineStart: 5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        <span>
          {isPaused ? renderWithLinks(currentSentence.plain, currentSentence.links) : partial}
          {showCursor && (
            <span
              style={{ display: 'inline-block', marginInlineStart: 4, verticalAlign: 'middle' }}
            >
              <LoadingDots color={cssVar.colorText} size={12} variant={'pulse'} />
            </span>
          )}
        </span>
      </Flexbox>
    );
  },
);

const WelcomeText = memo(() => {
  const { t } = useTranslation('welcome');

  const { pairs, currentIndex, advance } = useHomeDailyBrief();

  const dailySentences = useMemo<ParsedSentence[]>(
    () => pairs.map((p) => parseSentence(p.welcome)),
    [pairs],
  );

  // Fallback runs through the same DailyTypewriter so the height/layout
  // matches the daily mode. We pair up two short i18n welcome messages with
  // a `\n` so each fallback "sentence" still spans 2 lines and the page
  // doesn't feel half-empty before the daily brief lands.
  const fallbackSentences = useMemo<ParsedSentence[]>(() => {
    const messages = t('welcomeMessages', { returnObjects: true }) as Record<string, string>;
    const pool = shuffle(Object.values(messages));
    if (pool.length === 0) return [];

    const lines: string[] = [];
    for (let i = 0; i < pool.length; i += 2) {
      const a = pool[i];
      const b = pool[i + 1];
      // If the pool has an odd tail entry we still pair it with the first
      // line so each rendered sentence is at least 2 lines.
      const second = b ?? pool[0];
      lines.push(second && second !== a ? `${a}\n${second}` : a);
    }
    return lines.map((s) => ({ links: [], plain: s }));
  }, [t]);

  const useDaily = dailySentences.length > 0;
  const sentences = useDaily ? dailySentences : fallbackSentences;
  const onAdvance = useDaily ? advance : NOOP;
  // Daily mode: the controlled index lives in `useHomeDailyBrief` so InputArea
  // and WelcomeText stay in sync across remounts. Fallback mode: just start
  // from 0 — there is no shared hint to keep paired with.
  const sentenceIndex = useDaily ? currentIndex % Math.max(sentences.length, 1) : 0;

  if (sentences.length === 0) return null;

  return (
    <DailyTypewriter
      sentenceIndex={sentenceIndex}
      sentences={sentences}
      onSentenceComplete={onAdvance}
    />
  );
});

const NOOP = () => undefined;

export default WelcomeText;
