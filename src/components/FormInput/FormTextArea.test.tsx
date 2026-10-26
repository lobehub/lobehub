import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import FormTextArea from './FormTextArea';

describe('FormTextArea', () => {
  const user = userEvent.setup();
  const onChange = vi.fn();

  beforeEach(() => onChange.mockClear());

  test('shows the value it is given', () => {
    render(<FormTextArea value="line one" />);

    expect(screen.getByRole('textbox')).toHaveValue('line one');
  });

  test('keeps a multi-line prompt as typed: Enter is a new line, not a save', async () => {
    render(<FormTextArea onChange={onChange} />);
    const input = screen.getByRole('textbox');

    await user.type(input, 'first{enter}second');

    expect(input).toHaveValue('first\nsecond');
    expect(onChange).not.toHaveBeenCalled();
  });

  test('commits on blur, once, with the whole text', async () => {
    render(<FormTextArea onChange={onChange} />);
    const input = screen.getByRole('textbox');

    await user.type(input, 'answer billing questions');
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('answer billing questions');
  });

  test('also runs the caller’s own onBlur', async () => {
    const onBlur = vi.fn();
    render(<FormTextArea onBlur={onBlur} onChange={onChange} />);

    fireEvent.blur(screen.getByRole('textbox'));

    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  test('follows the form when the value is changed from outside (discard, reset)', () => {
    const { rerender } = render(<FormTextArea value="saved" />);

    rerender(<FormTextArea value="" />);
    expect(screen.getByRole('textbox')).toHaveValue('');

    rerender(<FormTextArea value="from the server" />);
    expect(screen.getByRole('textbox')).toHaveValue('from the server');
  });

  test('stops at the character limit', async () => {
    render(<FormTextArea maxLength={5} />);
    const input = screen.getByRole('textbox');

    await user.type(input, 'abcdefgh');

    expect(input).toHaveValue('abcde');
  });
});
