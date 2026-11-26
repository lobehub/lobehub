import type { Page } from '@playwright/test';

export const REVEAL_COLORS = {
  checker: ['#a3a3a3', '#d6d6d6'],
  element: '#ff2d9b',
  pseudo: '#1e90ff',
} as const;

const OUTLINE_GAP = 2;

export const revealCase = (page: Page, caseKey: string, targetKey: string) =>
  page.evaluate(
    ({ caseKey, colors, gap, targetKey }) => {
      const section = document.querySelector<HTMLElement>(`[data-case="${CSS.escape(caseKey)}"]`);
      if (!section) return false;
      const skip = (element: Element) =>
        ['LINK', 'META', 'SCRIPT', 'STYLE'].includes(element.tagName);
      let target: Element | undefined = section;
      for (const index of targetKey.split('.').slice(1).map(Number))
        target = target ? [...target.children].filter((child) => !skip(child))[index] : undefined;
      if (!target || target === section) return false;
      for (const backdrop of [document.documentElement, document.body])
        backdrop.style.setProperty(
          'background',
          `repeating-conic-gradient(${colors.checker[0]} 0 25%, ${colors.checker[1]} 0 50%) 0 0 / 12px 12px`,
          'important',
        );
      for (let node = target.parentElement; node && node !== section; node = node.parentElement) {
        const box = node.getBoundingClientRect();
        const { overflowX, overflowY } = getComputedStyle(node);
        if (
          (box.width === 0 || box.height === 0) &&
          (overflowX !== 'visible' || overflowY !== 'visible')
        )
          node.style.setProperty('overflow', 'visible', 'important');
      }
      target.setAttribute('data-synthetic-reveal', '');
      const style = document.createElement('style');
      style.textContent = `[data-synthetic-reveal]::before,[data-synthetic-reveal]::after{outline:1px dashed ${colors.pseudo} !important;outline-offset:${gap}px !important}`;
      document.head.append(style);
      const rect = target.getBoundingClientRect();
      const overlay = document.createElement('div');
      overlay.setAttribute('data-synthetic-overlay', '');
      Object.assign(overlay.style, {
        height: `${rect.height}px`,
        left: `${rect.left + scrollX}px`,
        outline: `1px dashed ${colors.element}`,
        outlineOffset: `${gap}px`,
        pointerEvents: 'none',
        position: 'absolute',
        top: `${rect.top + scrollY}px`,
        width: `${rect.width}px`,
        zIndex: '2147483647',
      });
      document.body.append(overlay);
      return true;
    },
    { caseKey, colors: REVEAL_COLORS, gap: OUTLINE_GAP, targetKey },
  );
