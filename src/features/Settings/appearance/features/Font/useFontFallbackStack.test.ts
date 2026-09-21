import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { APPLICATION_DEFAULT_FONT } from '../useSystemFontOptions';
import { useFontFallbackStack } from './useFontFallbackStack';

const options = [
  { label: 'System Default', value: APPLICATION_DEFAULT_FONT },
  { label: 'Inter', value: 'Inter' },
  { label: 'LXGW WenKai', value: '"LXGW WenKai"' },
  { label: 'Georgia', value: 'Georgia' },
  { label: 'Menlo', value: 'Menlo' },
];

const setup = (stack: string[]) => {
  const onChange = vi.fn();
  const { result } = renderHook(() => useFontFallbackStack({ onChange, options, stack }));
  return { onChange, result };
};

describe('useFontFallbackStack', () => {
  it('splits the stack into primary and fallbacks', () => {
    const { result } = setup(['Inter', 'Georgia']);

    expect(result.current.primary).toBe('Inter');
    expect(result.current.fallbacks).toEqual(['Georgia']);
    expect(result.current.atLimit).toBe(false);
  });

  it('has no primary for an empty stack', () => {
    const { result } = setup([]);

    expect(result.current.primary).toBeUndefined();
    expect(result.current.fallbacks).toEqual([]);
  });

  it('hides the default entry and disables fonts already in the stack', () => {
    const { result } = setup(['Inter', 'Georgia']);

    expect(result.current.candidates.map((o) => o.value)).not.toContain(APPLICATION_DEFAULT_FONT);
    expect(result.current.candidates.find((o) => o.value === 'Georgia')?.disabled).toBe(true);
    expect(result.current.candidates.find((o) => o.value === 'Inter')?.disabled).toBe(true);
    expect(result.current.candidates.find((o) => o.value === 'Menlo')?.disabled).toBeUndefined();
  });

  it('labels a font from its option and falls back to the raw value', () => {
    const { result } = setup(['Inter']);

    expect(result.current.labelOf('"LXGW WenKai"')).toBe('LXGW WenKai');
    expect(result.current.labelOf('"Lost Serif"')).toBe('"Lost Serif"');
  });

  it('appends, removes and reorders without touching the primary', () => {
    const { onChange, result } = setup(['Inter', 'Georgia', 'Menlo']);

    result.current.add('"LXGW WenKai"');
    expect(onChange).toHaveBeenLastCalledWith(['Inter', 'Georgia', 'Menlo', '"LXGW WenKai"']);

    result.current.remove('Georgia');
    expect(onChange).toHaveBeenLastCalledWith(['Inter', 'Menlo']);

    result.current.reorder(['Menlo', 'Georgia']);
    expect(onChange).toHaveBeenLastCalledWith(['Inter', 'Menlo', 'Georgia']);
  });

  it('reports the limit once three fallbacks exist', () => {
    const { result } = setup(['Inter', 'Georgia', 'Menlo', '"LXGW WenKai"']);

    expect(result.current.atLimit).toBe(true);
  });
});
