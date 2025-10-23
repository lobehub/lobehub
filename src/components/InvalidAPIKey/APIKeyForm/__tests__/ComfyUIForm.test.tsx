import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import APIKeyForm from '../index';

// Mock the dependencies
vi.mock('@/store/aiInfra', () => ({
  useAiInfraStore: vi.fn(() => ({
    updateAiProviderConfig: vi.fn(),
    useFetchAiProviderRuntimeState: vi.fn(() => ({})),
    aiProviderRuntimeConfig: {},
  })),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('antd-style', () => ({
  useTheme: () => ({
    colorTextSecondary: '#999',
  }),
  createStyles: vi.fn(() => () => ({ styles: {} })),
}));

vi.mock('@/components/FormInput', () => ({
  FormInput: vi.fn(({ value, onChange, ...props }) => (
    <input
      data-testid="form-input"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      {...props}
    />
  )),
  FormPassword: vi.fn(({ value, onChange, ...props }) => (
    <input
      data-testid="form-password"
      type="password"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      {...props}
    />
  )),
}));

vi.mock('@/components/KeyValueEditor', () => ({
  default: vi.fn(() => <div data-testid="key-value-editor">Key-Value Editor</div>),
}));

vi.mock('@lobehub/ui', () => ({
  Icon: vi.fn(({ icon, ...props }) => (
    <div data-testid="icon" {...props}>
      {icon?.name}
    </div>
  )),
  Select: vi.fn(({ value, options, onChange, ...props }) => (
    <select
      data-testid="select"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      {...props}
    >
      {options?.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )),
  Button: vi.fn(({ children, onClick, ...props }) => (
    <button data-testid="button" onClick={onClick} {...props}>
      {children}
    </button>
  )),
  ProviderIcon: vi.fn(() => <div data-testid="provider-icon">Provider Icon</div>),
}));

vi.mock('@lobehub/icons', () => ({
  ComfyUI: {
    Combine: vi.fn(() => <div data-testid="comfyui-icon">ComfyUI Icon</div>),
  },
  ProviderIcon: vi.fn(() => <div data-testid="provider-icon">Provider Icon</div>),
}));

vi.mock('react-layout-kit', () => ({
  Center: vi.fn(({ children, ...props }) => (
    <div data-testid="center" {...props}>
      {children}
    </div>
  )),
  Flexbox: vi.fn(({ children, ...props }) => (
    <div data-testid="flexbox" {...props}>
      {children}
    </div>
  )),
}));

vi.mock('@/features/Conversation/Error/style', () => ({
  FormAction: vi.fn(({ children, title, description, avatar, ...props }) => (
    <div data-testid="form-action" {...props}>
      <div data-testid="avatar">{avatar}</div>
      <div data-testid="title">{title}</div>
      <div data-testid="description">{description}</div>
      {children}
    </div>
  )),
  ErrorActionContainer: vi.fn(({ children, ...props }) => (
    <div data-testid="error-action-container" {...props}>
      {children}
    </div>
  )),
}));

describe('ComfyUIForm Integration', () => {
  const mockProps = {
    bedrockDescription: 'bedrock.description',
    description: 'comfyui.description',
    id: 'test-batch-id',
    onClose: vi.fn(),
    onRecreate: vi.fn(),
    provider: ModelProvider.ComfyUI,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use ComfyUI provider correctly', () => {
    expect(ModelProvider.ComfyUI).toBe('comfyui');
  });

  it('should import APIKeyForm without errors', () => {
    expect(APIKeyForm).toBeDefined();
  });
});
