export interface TocHeading {
  element: HTMLElement;
  level: 1 | 2 | 3;
  text: string;
}

const HEADING_SELECTOR = 'h1, h2, h3';

/**
 * The page body is the first Lexical root inside the editor content; later roots
 * belong to the comment composers rendered below it.
 */
export const findBodyRoot = (content: ParentNode | null | undefined): HTMLElement | null =>
  content?.querySelector<HTMLElement>('[data-lexical-editor]') ?? null;

export const collectHeadings = (root: ParentNode | null | undefined): TocHeading[] => {
  if (!root) return [];

  const headings: TocHeading[] = [];

  for (const element of root.querySelectorAll<HTMLElement>(HEADING_SELECTOR)) {
    const text = element.textContent?.trim();
    if (!text) continue;

    headings.push({ element, level: Number(element.tagName[1]) as TocHeading['level'], text });
  }

  return headings;
};

/**
 * Index of the heading whose section is being read: the last heading that has
 * scrolled past `threshold` px below the top of the viewport. Before the first
 * heading is reached, the first one is active. Once the pane is scrolled to the
 * bottom, a short final section may never reach the threshold, so the last
 * heading is active.
 */
export const findActiveIndex = (offsets: number[], threshold: number, atBottom = false): number => {
  if (offsets.length === 0) return -1;
  if (atBottom) return offsets.length - 1;

  let active = 0;

  for (const [index, offset] of offsets.entries()) {
    if (offset > threshold) break;
    active = index;
  }

  return active;
};

/** Same headings in the same order, so the rendered outline would not change. */
export const isSameOutline = (a: TocHeading[], b: TocHeading[]): boolean =>
  a.length === b.length &&
  a.every(
    (heading, index) =>
      heading.element === b[index].element &&
      heading.level === b[index].level &&
      heading.text === b[index].text,
  );
