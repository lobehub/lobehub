import { getPythonInterpreter } from '@lobechat/python-interpreter';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pythonService } from '../python';

vi.mock('@lobechat/python-interpreter', () => ({
  getPythonInterpreter: vi.fn(),
}));

const stubInterpreter = (result = { result: '42', stdout: '', stderr: '' }) => {
  const interpreter = {
    downloadFiles: vi.fn().mockResolvedValue([]),
    init: vi.fn().mockResolvedValue(undefined),
    installPackages: vi.fn().mockResolvedValue(undefined),
    runPython: vi.fn().mockResolvedValue(result),
    uploadFiles: vi.fn().mockResolvedValue(undefined),
  };

  return { ctor: vi.fn().mockImplementation(() => Promise.resolve(interpreter)), interpreter };
};

describe('PythonService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Returning undefined here made the caller complete the tool call as a success
  // and write `JSON.stringify(undefined)` as its content, so a CSP-blocked
  // interpreter looked like Python that ran and produced nothing.
  it('rejects when the interpreter is unavailable', async () => {
    vi.mocked(getPythonInterpreter).mockReturnValue(undefined);

    await expect(pythonService.runPython('print(1)', [], [])).rejects.toThrow(
      'Python interpreter is unavailable',
    );
  });

  it('propagates a blocked interpreter construction', async () => {
    vi.mocked(getPythonInterpreter).mockImplementation(() => {
      throw new DOMException('cannot be accessed from origin', 'SecurityError');
    });

    await expect(pythonService.runPython('print(1)', [], [])).rejects.toThrow(
      'cannot be accessed from origin',
    );
  });

  it('runs the code when the interpreter is available', async () => {
    const { ctor, interpreter } = stubInterpreter();
    vi.mocked(getPythonInterpreter).mockReturnValue(ctor as never);

    const response = await pythonService.runPython('1 + 41', ['numpy', ''], []);

    expect(interpreter.installPackages).toHaveBeenCalledWith(['numpy']);
    expect(interpreter.runPython).toHaveBeenCalledWith('1 + 41');
    expect(response).toEqual({ files: [], result: '42', stdout: '', stderr: '' });
  });
});
