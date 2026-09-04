/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import FormSliderWithInput from './FormSliderWithInput';

vi.mock('@lobehub/ui/base-ui', () => ({
  SliderWithInput: ({
    onChange,
    value,
  }: {
    onChange?: (value: number) => void;
    value?: number;
  }) => (
    <>
      <input
        aria-label="slider-input"
        type="number"
        value={value}
        onChange={(event) => onChange?.(Number(event.target.value))}
      />
      <button type="button">slider-thumb</button>
    </>
  ),
}));

describe('FormSliderWithInput', () => {
  it('commits the latest input value when focus leaves the control', async () => {
    const onChange = vi.fn();
    render(
      <>
        <FormSliderWithInput value={2} onChange={onChange} />
        <button type="button">outside</button>
      </>,
    );

    const input = screen.getByRole('spinbutton', { name: 'slider-input' });
    fireEvent.change(input, { target: { value: '3' } });

    await waitFor(() => expect(input).toHaveValue(3));
    fireEvent.blur(input, { relatedTarget: screen.getByRole('button', { name: 'outside' }) });

    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('does not commit while focus moves within the control', () => {
    const onChange = vi.fn();
    render(<FormSliderWithInput value={2} onChange={onChange} />);

    fireEvent.blur(screen.getByRole('spinbutton', { name: 'slider-input' }), {
      relatedTarget: screen.getByRole('button', { name: 'slider-thumb' }),
    });

    expect(onChange).not.toHaveBeenCalled();
  });
});
