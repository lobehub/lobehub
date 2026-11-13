import { describe, expect, it } from 'vitest';

import { edgeLabelMode, edgeLabelText } from './edgeLabel';

describe('edgeLabelText', () => {
  it('joins the action and the branch condition, and is empty when the edge has neither', () => {
    expect(edgeLabelText({ condition: 'paid', label: 'Checks out' })).toBe('Checks out · paid');
    expect(edgeLabelText({ condition: null, label: 'Checks out' })).toBe('Checks out');
    expect(edgeLabelText({ condition: 'paid', label: '' })).toBe('paid');
    expect(edgeLabelText({ condition: null, label: '' })).toBe('');
  });
});

describe('edgeLabelMode', () => {
  const resting = { hovered: false, k: 1, linked: false, room: 64, text: 'Checks out' };

  it('shows the full label of an edge the user points at, at any zoom', () => {
    expect(edgeLabelMode({ ...resting, hovered: true, k: 0.1 })).toBe('full');
  });

  it('shows the full labels around the selected board until they would pile up', () => {
    expect(edgeLabelMode({ ...resting, k: 0.5, linked: true })).toBe('full');
    expect(edgeLabelMode({ ...resting, k: 0.13, linked: true })).toBe('none');
  });

  it('keeps a resting label inside the gap between its boards', () => {
    expect(edgeLabelMode(resting)).toBe('inline');
  });

  it('drops a resting label once it is too small to read or has no room', () => {
    expect(edgeLabelMode({ ...resting, k: 0.3 })).toBe('none');
    expect(edgeLabelMode({ ...resting, room: 20 })).toBe('none');
  });

  it('shows nothing for an edge without text', () => {
    expect(edgeLabelMode({ ...resting, hovered: true, text: '' })).toBe('none');
  });
});
