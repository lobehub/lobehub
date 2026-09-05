import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuvApiName } from '../../types';
import { auvExecutor } from './index';

const { runCommandMock } = vi.hoisted(() => ({
  runCommandMock: vi.fn(),
}));

vi.mock('@/services/electron/auv', () => ({
  electronAuvService: {
    runCommand: runCommandMock,
  },
}));

describe('auvExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards a typed CLI invocation through Electron IPC', async () => {
    const params = { argv: ['invoke', 'display.capture'] };
    const invocation = {
      argv: params.argv,
      output: { artifacts: [{ file_path: '/tmp/capture.png' }] },
    };
    runCommandMock.mockResolvedValue(invocation);

    const result = await auvExecutor.invoke(AuvApiName.runCommand, params, {
      messageId: 'test-message',
    });

    expect(runCommandMock).toHaveBeenCalledWith(params);
    expect(result).toEqual({
      content: JSON.stringify(invocation),
      state: invocation,
      success: true,
    });
  });
});
