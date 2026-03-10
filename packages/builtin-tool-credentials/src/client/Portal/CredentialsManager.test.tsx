import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CredentialsManager from './CredentialsManager';

vi.mock('@lobehub/ui', () => ({
  Button: ({ children, danger: _danger, icon, loading: _loading, title, ...rest }: any) => (
    <button {...rest} title={title}>
      {icon}
      {children}
    </button>
  ),
  Empty: ({ description }: any) => <div>{description}</div>,
  Flexbox: ({ children, horizontal: _horizontal, ...rest }: any) => <div {...rest}>{children}</div>,
  InputPassword: ({
    onBlur,
    onChange,
    onFocus,
    onPressEnter,
    readOnly,
    value,
    visibilityToggle = true,
    ...rest
  }: any) => {
    const [visible, setVisible] = useState(false);
    const controlledVisible =
      typeof visibilityToggle === 'object' ? !!visibilityToggle.visible : visible;

    return (
      <span>
        <input
          {...rest}
          readOnly={readOnly}
          type={controlledVisible ? 'text' : 'password'}
          value={value ?? ''}
          onBlur={onBlur}
          onChange={onChange}
          onFocus={onFocus}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onPressEnter?.(event);
          }}
        />
        {visibilityToggle && (
          <span
            aria-label={controlledVisible ? 'eye' : 'eye-invisible'}
            onMouseDown={(event) => {
              event.preventDefault();
              if (typeof visibilityToggle === 'object') {
                visibilityToggle.onVisibleChange?.(!controlledVisible);
              } else {
                setVisible((v) => !v);
              }
            }}
          />
        )}
      </span>
    );
  },
  Text: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (!params) return key;
      return `${key}:${JSON.stringify(params)}`;
    },
  }),
}));

vi.mock('antd', async () => {
  const actual = await vi.importActual('antd');
  return {
    ...actual,
    Popconfirm: ({ children, onConfirm }: any) => (
      <span
        onClick={() => {
          onConfirm?.();
        }}
      >
        {children}
      </span>
    ),
    message: {
      error: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
    },
  };
});

const Harness = () => {
  const [vaults, setVaults] = useState<Record<string, any>>({
    moltbook: { apiKey: 'moltbook_secret_1234' },
  });

  return (
    <CredentialsManager
      keyVaults={vaults}
      onPersist={async (next) => {
        setVaults(next);
      }}
    />
  );
};

const HarnessWithPrefix = ({ forcedPrefix }: { forcedPrefix: string }) => {
  const [vaults, setVaults] = useState<Record<string, any>>({
    github: { token: 'ghp_xxx' },
    moltbook: { apiKey: 'moltbook_secret_1234' },
  });

  return (
    <CredentialsManager
      forcedPrefix={forcedPrefix}
      keyVaults={vaults}
      onPersist={async (next) => {
        setVaults(next);
      }}
    />
  );
};

describe('CredentialsManager', () => {
  afterEach(() => {
    cleanup();
    if (vi.isFakeTimers()) {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
    vi.restoreAllMocks();
  });

  it('renders existing credentials list', () => {
    render(<Harness />);

    expect(screen.getByTestId('credential-item-moltbook.apiKey')).toBeDefined();
    expect(screen.getByText('moltbook.apiKey')).toBeDefined();
    expect(screen.getByTestId('credential-value-moltbook.apiKey')).toBeDefined();
  });

  it('saves new credential and updates list', async () => {
    render(<Harness />);

    fireEvent.change(screen.getByPlaceholderText('builtins.lobe-credentials.ui.pathPlaceholder'), {
      target: { value: 'github.token' },
    });
    fireEvent.change(screen.getByPlaceholderText('builtins.lobe-credentials.ui.valuePlaceholder'), {
      target: { value: 'ghp_xxx' },
    });

    fireEvent.click(screen.getByText('builtins.lobe-credentials.ui.save'));

    await waitFor(() => {
      expect(screen.getByTestId('credential-item-github.token')).toBeDefined();
    });
  });

  it('updates existing credential from list item', async () => {
    render(<Harness />);

    const valueInput = screen.getByTestId('credential-value-moltbook.apiKey') as HTMLInputElement;

    fireEvent.focus(valueInput);

    fireEvent.change(valueInput, {
      target: { value: 'moltbook_secret_updated' },
    });
    fireEvent.blur(valueInput);

    await waitFor(() => {
      const nextInput = screen.getByTestId('credential-value-moltbook.apiKey') as HTMLInputElement;
      fireEvent.focus(nextInput);
      expect(nextInput.value).toBe('moltbook_secret_updated');
    });
  });

  it('does not render dedicated update button', () => {
    render(<Harness />);

    expect(screen.queryByTestId('credential-update-moltbook.apiKey')).toBeNull();
  });

  it('toggles reveal icon inside input for credential display', () => {
    render(<Harness />);

    const row = screen.getByTestId('credential-item-moltbook.apiKey');
    const valueInput = screen.getByTestId('credential-value-moltbook.apiKey') as HTMLInputElement;

    expect(valueInput.type).toBe('password');
    expect(valueInput.value).toHaveLength(32);

    fireEvent.mouseDown(within(row).getByLabelText('eye-invisible'));
    expect(valueInput.type).toBe('text');
    expect(valueInput.value).toBe('moltbook_secret_1234');

    fireEvent.mouseDown(within(row).getByLabelText('eye'));
    expect(valueInput.type).toBe('password');
    expect(valueInput.value).toHaveLength(32);
  });

  it('deletes credential and updates list', async () => {
    render(<Harness />);

    fireEvent.click(screen.getByTestId('credential-delete-moltbook.apiKey'));

    await waitFor(() => {
      expect(screen.queryByTestId('credential-item-moltbook.apiKey')).toBeNull();
    });
  });

  it('deletes credential safely while input is focused', async () => {
    render(<Harness />);

    const valueInput = screen.getByTestId('credential-value-moltbook.apiKey') as HTMLInputElement;
    fireEvent.focus(valueInput);
    fireEvent.change(valueInput, {
      target: { value: 'temp_edit_value' },
    });

    const deleteButton = screen.getByTestId('credential-delete-moltbook.apiKey');
    fireEvent.mouseDown(deleteButton);
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(screen.queryByTestId('credential-item-moltbook.apiKey')).toBeNull();
    });
  });

  it('uses password input display for credential value', () => {
    render(<Harness />);

    const valueInput = screen.getByTestId('credential-value-moltbook.apiKey') as HTMLInputElement;
    expect(valueInput.type).toBe('password');
    expect(valueInput.value).toHaveLength(32);
    expect(valueInput.value).not.toBe('moltbook_secret_1234');

    fireEvent.focus(valueInput);
    expect(valueInput.value).toBe('moltbook_secret_1234');

    fireEvent.blur(valueInput);
    expect(valueInput.value).toHaveLength(32);
  });

  it('shows only forced prefix credentials', () => {
    render(<HarnessWithPrefix forcedPrefix="moltbook" />);

    expect(screen.getByTestId('credential-item-moltbook.apiKey')).toBeDefined();
    expect(screen.queryByTestId('credential-item-github.token')).toBeNull();
  });

  it('blocks creating credential outside forced prefix', async () => {
    render(<HarnessWithPrefix forcedPrefix="moltbook" />);

    fireEvent.change(screen.getByPlaceholderText('builtins.lobe-credentials.ui.pathPlaceholder'), {
      target: { value: 'github.newToken' },
    });
    fireEvent.change(screen.getByPlaceholderText('builtins.lobe-credentials.ui.valuePlaceholder'), {
      target: { value: 'new_token' },
    });

    fireEvent.click(screen.getByText('builtins.lobe-credentials.ui.save'));

    await waitFor(() => {
      expect(screen.queryByTestId('credential-item-github.newToken')).toBeNull();
    });
  });
});
