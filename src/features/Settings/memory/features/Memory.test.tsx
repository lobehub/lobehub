/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FormInstance } from 'antd';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MemorySetting from './Memory';

const setSettingsMock = vi.hoisted(() => vi.fn());
const memorySettingsMock = vi.hoisted(() => ({ value: {} as { enabled?: boolean } }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true }),
}));

vi.mock('@/hooks/useSaveState', () => ({
  useSaveState: () => ({
    lastSavedAt: undefined,
    retry: vi.fn(),
    save: (callback: () => void) => callback(),
    status: 'idle',
  }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      defaultSettings: {},
      isUserStateInit: true,
      setSettings: setSettingsMock,
      settings: { memory: memorySettingsMock.value },
    }),
}));

vi.mock('@/components/Editor/AutoSaveHint', () => ({ default: () => null }));
vi.mock('@/const/layoutTokens', () => ({ FORM_STYLE: {} }));
vi.mock('@/features/ModelSwitchPanel/components/ControlsForm/LevelSlider', () => ({
  default: () => null,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Switch: ({
    checked,
    disabled,
    onChange,
  }: {
    checked?: boolean;
    disabled?: boolean;
    onChange?: (checked: boolean) => void;
  }) => (
    <button
      aria-checked={!!checked}
      disabled={disabled}
      role="switch"
      onClick={() => onChange?.(!checked)}
    />
  ),
}));

vi.mock('@lobehub/ui', async () => {
  const { Form: AntdForm } = await import('antd');

  const Form = Object.assign(
    ({
      form,
      initialValues,
      items,
      onValuesChange,
    }: {
      form?: FormInstance<Record<string, unknown>>;
      initialValues: Record<string, unknown>;
      items: Array<{
        children: Array<{ children: ReactNode; name?: string; valuePropName?: string }>;
      }>;
      onValuesChange: (values: Record<string, unknown>) => void;
    }) => (
      <AntdForm form={form} initialValues={initialValues} onValuesChange={onValuesChange}>
        {items.flatMap((group) =>
          group.children.flatMap((item) => {
            if (!item.name) return [];

            return [
              <AntdForm.Item key={item.name} name={item.name} valuePropName={item.valuePropName}>
                {item.children}
              </AntdForm.Item>,
            ];
          }),
        )}
      </AntdForm>
    ),
    { useForm: AntdForm.useForm },
  );

  return {
    Form,
    Skeleton: () => null,
    Tooltip: ({ children }: { children: ReactNode }) => children,
  };
});

describe('MemorySetting', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    memorySettingsMock.value = {};
  });

  it('shows memory as enabled when the setting has not been persisted', () => {
    render(<MemorySetting />);

    const toggle = screen.getByRole('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('persists toggle changes', () => {
    memorySettingsMock.value = { enabled: false };
    render(<MemorySetting />);

    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);

    expect(setSettingsMock).toHaveBeenCalledWith({ memory: { enabled: true } });
  });
});
