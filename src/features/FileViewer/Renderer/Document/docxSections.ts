export interface DocxSection {
  element: HTMLElement;
  title: string;
}

const MAX_TITLE_LENGTH = 24;
const MIN_HEADING_RATIO = 1.15;
const MAX_SECTIONS = 40;
const TIER_TOLERANCE = 0.5;

// docx-preview carries a run's point size and weight on the inner <span>, not
// on the <p>, which keeps the body default. Measuring the paragraph therefore
// reports one uniform size for the whole document and finds no headings at all.
// The run holding most of the paragraph's text is what a reader perceives as
// that line's size.
const dominantRun = (element: HTMLElement): HTMLElement => {
  let best: HTMLElement | undefined;
  let bestLength = 0;
  for (const child of element.children) {
    const length = (child.textContent ?? '').trim().length;
    if (length > bestLength) {
      best = child as HTMLElement;
      bestLength = length;
    }
  }
  return best ?? element;
};

const readFontSize = (element: HTMLElement): number =>
  Number.parseFloat(globalThis.getComputedStyle(dominantRun(element)).fontSize) || 0;

const isBold = (element: HTMLElement): boolean => {
  const weight = globalThis.getComputedStyle(dominantRun(element)).fontWeight;
  return weight === 'bold' || Number(weight) >= 600;
};

const trimTitle = (text: string): string => {
  const clean = text.replaceAll(/\s+/gu, ' ').trim();
  return clean.length > MAX_TITLE_LENGTH ? `${clean.slice(0, MAX_TITLE_LENGTH)}…` : clean;
};

/**
 * Derive a section list from a rendered docx.
 *
 * Real-world docx files routinely carry no heading styles at all — a 100-block
 * itinerary where every paragraph is `Normal` and the hierarchy lives only in
 * point size. So semantic headings are used when the file has them, and
 * otherwise sections are inferred the way `classifySheet` infers a sheet's
 * shape: the body's dominant font size is the baseline, and bold runs clearly
 * above it are section starts. The first such block is skipped — that is the
 * document title, not a section.
 */
export const collectDocxSections = (root: HTMLElement): DocxSection[] => {
  const semantic = [...root.querySelectorAll<HTMLElement>('h1, h2, h3')];
  if (semantic.length > 1) {
    return semantic
      .slice(0, MAX_SECTIONS)
      .map((element) => ({ element, title: trimTitle(element.textContent ?? '') }))
      .filter((section) => section.title.length > 0);
  }

  const blocks = [...root.querySelectorAll<HTMLElement>('p')].filter(
    (element) => (element.textContent ?? '').trim().length > 0,
  );
  if (blocks.length === 0) return [];

  // Weighted by characters, not by block count: a document whose body is a few
  // long paragraphs and whose headings are many short lines would otherwise
  // elect the heading size as the baseline and find no sections at all. Ties
  // resolve to the smaller size, which is the body by construction.
  const weights = new Map<number, number>();
  for (const block of blocks) {
    const size = Math.round(readFontSize(block));
    const length = (block.textContent ?? '').trim().length;
    weights.set(size, (weights.get(size) ?? 0) + length);
  }
  const baseline = [...weights.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];

  // The masthead — title and subtitle — is set at heading size but is not a
  // section. It is whatever precedes the document's first body-size text, and
  // it must go before the tier is chosen, or a 24pt title elects itself the
  // only section and the 16pt day headings are all dropped.
  const firstBodyIndex = blocks.findIndex(
    (block) => readFontSize(block) < baseline * MIN_HEADING_RATIO,
  );
  const body = firstBodyIndex >= 0 ? blocks.slice(firstBodyIndex) : blocks;

  const candidates = body.filter(
    (block) => isBold(block) && readFontSize(block) >= baseline * MIN_HEADING_RATIO,
  );
  if (candidates.length === 0) return [];

  // Only the largest remaining tier is a section. A file with day headings and
  // two levels of bold sub-labels otherwise produces one flat strip mixing all
  // of them, which reads as noise rather than as navigation.
  const topSize = Math.max(...candidates.map((block) => readFontSize(block)));

  return candidates
    .filter((block) => readFontSize(block) >= topSize - TIER_TOLERANCE)
    .slice(0, MAX_SECTIONS)
    .map((element) => ({ element, title: trimTitle(element.textContent ?? '') }))
    .filter((section) => section.title.length > 0);
};
