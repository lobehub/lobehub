import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { electronSystemService } from '@/services/electron/system';
import { useUserStore } from '@/store/user';

import Terminal from './index';

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal()),
  isDesktop: true,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobehub/ui', () => ({
  Form: ({
    items,
  }: {
    items: {
      children: { children?: ReactNode; desc?: ReactNode; label: ReactNode }[];
      title: string;
    }[];
  }) => (
    <div>
      {items.map((group) => (
        <section key={group.title}>
          <h2>{group.title}</h2>
          {group.children.map((item, index) => (
            <div key={index}>
              <span>{item.label}</span>
              <span>{item.desc}</span>
              {item.children}
            </div>
          ))}
        </section>
      ))}
    </div>
  ),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Select: ({
    'aria-label': ariaLabel,
    options,
    value,
    onChange,
  }: {
    'aria-label'?: string;
    'onChange': (value: string) => void;
    'options': { label: string; value: string }[];
    'value': string;
  }) => (
    <select aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@/components/Editor/AutoSaveHint', () => ({ default: () => null }));

vi.mock('@/features/SettingsSearch/anchor', () => ({
  SettingsSearchAnchor: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/useSaveState', () => ({
  useSaveState: () => ({
    lastSavedAt: undefined,
    retry: vi.fn(),
    save: (action: () => unknown) => action(),
    status: 'idle',
  }),
}));

vi.mock('@/services/electron/system', () => ({
  electronSystemService: {
    getSystemMonospaceFonts: vi.fn(),
  },
}));

const initialUserStoreState = useUserStore.getState();

beforeEach(() => {
  vi.mocked(electronSystemService.getSystemMonospaceFonts).mockResolvedValue([
    { label: 'Courier New', value: '"Courier New"' },
    { label: 'Menlo', value: 'Menlo' },
  ]);
});

afterEach(() => {
  cleanup();
  useUserStore.setState(initialUserStoreState, true);
});

describe('Terminal appearance settings', () => {
  it('stays hidden and does not query fonts until the built-in terminal feature is enabled', () => {
    useUserStore.setState({
      preference: { lab: { enableBuiltinTerminal: false } },
    });

    render(<Terminal />);

    expect(screen.queryByText('settingAppearance.terminal.title')).toBeNull();
    expect(electronSystemService.getSystemMonospaceFonts).not.toHaveBeenCalled();
  });

  it('shows installed monospace fonts and persists the selection', async () => {
    const updatePreference = vi.fn();
    useUserStore.setState({
      preference: { lab: { enableBuiltinTerminal: true } },
      updatePreference,
    });

    render(<Terminal />);

    expect(screen.getByText('settingAppearance.terminal.title')).toBeDefined();
    const select = screen.getByRole('combobox', {
      name: 'settingAppearance.terminal.fontFamily.title',
    });

    await waitFor(() => expect(screen.getByRole('option', { name: 'Menlo' })).toBeDefined());
    fireEvent.change(select, { target: { value: '"Courier New"' } });

    expect(electronSystemService.getSystemMonospaceFonts).toHaveBeenCalledOnce();
    expect(updatePreference).toHaveBeenCalledWith({ terminalFontFamily: '"Courier New"' });
  });

  it('stores an empty value when the application default is selected', async () => {
    const updatePreference = vi.fn();
    useUserStore.setState({
      preference: { lab: { enableBuiltinTerminal: true }, terminalFontFamily: 'Menlo' },
      updatePreference,
    });

    render(<Terminal />);

    const select = screen.getByRole('combobox', {
      name: 'settingAppearance.terminal.fontFamily.title',
    });

    await waitFor(() => expect(screen.getByRole('option', { name: 'Menlo' })).toBeDefined());
    fireEvent.change(select, { target: { value: '__application_default__' } });

    expect(updatePreference).toHaveBeenCalledWith({ terminalFontFamily: '' });
  });
});
