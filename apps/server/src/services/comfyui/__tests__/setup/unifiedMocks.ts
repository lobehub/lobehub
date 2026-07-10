// @vitest-environment node
import { vi } from 'vitest';

// Create mock PromptBuilder class first
const MockPromptBuilder = vi.fn().mockImplementation((workflow: any) => ({
  input: vi.fn().mockReturnThis(),
  setInputNode: vi.fn().mockReturnThis(),
  setOutputNode: vi.fn().mockReturnThis(),
  workflow, // Expose the workflow for testing
}));

// Module-level mock for @saintno/comfyui-sdk
vi.mock('@saintno/comfyui-sdk', () => ({
  CallWrapper: vi.fn().mockImplementation(() => ({
    call: vi.fn(),
    execute: vi.fn(),
  })),
  ComfyApi: vi.fn().mockImplementation((baseURL: string, clientId?: string, options?: any) => ({
    baseURL,
    clientId,
    connect: vi.fn(),
    disconnect: vi.fn(),
    getObjectInfo: vi.fn().mockResolvedValue({}),
    init: vi.fn(),
    options,
  })),
  PromptBuilder: MockPromptBuilder,
  seed: vi.fn(() => 42),
}));

export const setupAllMocks = () => {
  // Mock other utility functions
  vi.mock('../utils/promptSplitter', () => ({
    splitPromptForDualCLIP: vi.fn((prompt: string) => ({
      clipLPrompt: prompt,
      t5xxlPrompt: prompt,
    })),
  }));

  vi.mock('../utils/weightDType', () => ({
    selectOptimalWeightDtype: vi.fn(() => 'default'),
  }));

  // Enhanced PromptBuilder mock to record parameters
  const inputCalls = new Map<string, any>();

  return { inputCalls };
};
