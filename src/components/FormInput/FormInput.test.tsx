import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import FormInput from './FormInput';

describe('FormInput', () => {
  const user = userEvent.setup();
  const onChangeMock = vi.fn();

  beforeEach(() => {
    onChangeMock.mockClear();
  });

  test('正确渲染初始值', () => {
    render(<FormInput value="initial value" />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('initial value');
  });

  test('输入值并在失焦时触发 onChange', async () => {
    render(<FormInput onChange={onChangeMock} />);
    const input = screen.getByRole('textbox');

    await user.type(input, 'new value');
    expect(input).toHaveValue('new value');
    expect(onChangeMock).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(onChangeMock).toHaveBeenCalledWith('new value');
  });

  test('失焦时同时触发 onChange 和外部 onBlur', async () => {
    const onBlurMock = vi.fn();
    render(<FormInput onBlur={onBlurMock} onChange={onChangeMock} />);
    const input = screen.getByRole('textbox');

    await user.type(input, 'typed');
    fireEvent.blur(input);
    expect(onChangeMock).toHaveBeenCalledWith('typed');
    expect(onBlurMock).toHaveBeenCalledTimes(1);
  });

  test('按下 Enter 触发 onChange', async () => {
    render(<FormInput onChange={onChangeMock} />);
    const input = screen.getByRole('textbox');

    await user.type(input, 'test{enter}');
    expect(onChangeMock).toHaveBeenCalledWith('test');
  });

  test('中文输入时按下 Enter 不触发 onChange', async () => {
    render(<FormInput onChange={onChangeMock} />);
    const input = screen.getByRole('textbox');

    // 模拟中文输入法开始
    fireEvent.compositionStart(input);
    await user.type(input, 'nihao');
    await user.type(input, '{enter}');

    // 中文输入法结束前按 Enter 不应触发
    expect(onChangeMock).not.toHaveBeenCalled();

    // 结束中文输入
    fireEvent.compositionEnd(input);
    await user.type(input, '{enter}');
    expect(onChangeMock).toHaveBeenCalledWith('nihao');
  });

  test('初始值为空、之后注入值时同步显示', () => {
    const { rerender } = render(<FormInput value={undefined} />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('');

    rerender(<FormInput value="loaded value" />);
    expect(input).toHaveValue('loaded value');
  });

  test('defaultValue 更新时同步显示新值', async () => {
    const { rerender } = render(<FormInput value="old value" />);

    // 初始值
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('old value');

    // 更新值并重新渲染
    rerender(<FormInput value="new value" />);
    expect(input).toHaveValue('new value');
  });
});
