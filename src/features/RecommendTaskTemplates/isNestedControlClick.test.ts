/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest';

import { isNestedControlClick } from './isNestedControlClick';

const mountCard = (html: string) => {
  const card = document.createElement('div');
  card.innerHTML = html;
  document.body.append(card);
  return card;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('isNestedControlClick', () => {
  it('treats a click on the card body as the card action', () => {
    const card = mountCard('<p class="summary">Summary</p>');

    expect(isNestedControlClick(card.querySelector('.summary'), card)).toBe(false);
    expect(isNestedControlClick(card, card)).toBe(false);
  });

  it('treats a tap on the schedule info icon as its own action', () => {
    // ActionIcon renders a <button> around the lucide <svg>; taps land on the svg.
    const card = mountCard('<button type="button"><svg class="lucide-clock"></svg></button>');

    expect(isNestedControlClick(card.querySelector('.lucide-clock'), card)).toBe(true);
  });

  it('treats links and role=button elements as nested controls', () => {
    const card = mountCard(
      '<a href="/x" class="link">Docs</a><div role="button" class="rb"></div>',
    );

    expect(isNestedControlClick(card.querySelector('.link'), card)).toBe(true);
    expect(isNestedControlClick(card.querySelector('.rb'), card)).toBe(true);
  });

  it('ignores controls outside the card and non-element targets', () => {
    const wrapper = mountCard('<div class="card"><p class="body">Body</p></div>');
    const outer = document.createElement('button');
    outer.append(wrapper);
    document.body.append(outer);
    const card = wrapper.querySelector('.card')!;

    expect(isNestedControlClick(card.querySelector('.body'), card)).toBe(false);
    expect(isNestedControlClick(null, card)).toBe(false);
  });
});
