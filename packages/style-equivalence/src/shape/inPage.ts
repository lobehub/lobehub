import type { ComponentShape, ShapeTarget } from '../plan/shapes';

// Self-contained: the learn step serializes this function into the probe page.
export const readShapesInPage = (marks: { className: string; slotPrefix: string }) => {
  const skip = (element: Element) =>
    ['LINK', 'META', 'NOSCRIPT', 'SCRIPT', 'STYLE', 'TEMPLATE'].includes(element.tagName);
  const result: Record<string, ComponentShape> = {};
  const sections = [...document.querySelectorAll('[data-shape-probe]')].sort(
    (a, b) => Number(a.hasAttribute('data-shape-leaf')) - Number(b.hasAttribute('data-shape-leaf')),
  );
  for (const section of sections) {
    const key = section.getAttribute('data-shape-probe')!;
    const leaf = section.hasAttribute('data-shape-leaf');
    if (result[key] || section.querySelector('[data-shape-error]')) continue;
    const roots = [...section.children].filter((element) => !skip(element));
    if (roots.length !== 1) continue;
    const [root] = roots;
    const all = [root, ...root.querySelectorAll('*')].filter((element) => !skip(element));
    const pathOf = (element: Element) => {
      const path: number[] = [];
      for (let node = element; node !== root; node = node.parentElement!)
        path.unshift(
          [...node.parentElement!.children].filter((child) => !skip(child)).indexOf(node),
        );
      return path;
    };
    const locate = (name: string): ShapeTarget | undefined => {
      const found = all.filter((element) => element.classList.contains(name));
      return found.length === 1
        ? { path: pathOf(found[0]), tag: found[0].tagName.toLowerCase() }
        : undefined;
    };
    const slots: Record<string, ShapeTarget> = {};
    const names = new Set(
      all.flatMap((element) =>
        [...element.classList].filter((name) => name.startsWith(marks.slotPrefix)),
      ),
    );
    for (const name of [...names].sort()) {
      const target = locate(name);
      if (target) slots[name.slice(marks.slotPrefix.length)] = target;
    }
    const className = locate(marks.className);
    result[key] = {
      ...(className ? { className } : {}),
      ...(leaf ? { leaf: true as const } : {}),
      root: root.tagName.toLowerCase(),
      slots,
      tags: [...new Set(all.map((element) => element.tagName.toLowerCase()))].sort(),
    };
  }
  return result;
};
