import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ragService } from '@/services/rag';
import type { LobeAgentConfig } from '@/types/agent';
import type { FileItem } from '@/types/files';

import { useAgentStore } from '../../store';

vi.mock('@/services/rag', () => ({ ragService: { parseFileContent: vi.fn() } }));
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('~base-ui-stubs')).baseUiStubs,
}));

beforeEach(() => {
  vi.mocked(ragService.parseFileContent).mockReset();
  useAgentStore.setState({ activeAgentId: undefined, agentMap: {} });
});

afterEach(() => vi.restoreAllMocks());

describe('ensureAgentFileContents', () => {
  const knowledgeFile = (overrides: Partial<FileItem>): FileItem => ({
    createdAt: new Date('2026-01-01'),
    id: 'file-1',
    name: 'notes.md',
    size: 10,
    type: 'text/markdown',
    updatedAt: new Date('2026-01-01'),
    url: 'https://example.com/notes.md',
    ...overrides,
  });

  const mountFiles = (files: FileItem[]) => {
    useAgentStore.setState({
      activeAgentId: 'agent-1',
      // Knowledge files ride along on the agent config but are not a column on
      // the agents row `agentMap` is typed against.
      agentMap: { 'agent-1': { files } as any },
    });
  };

  const contentOf = (index: number) =>
    (useAgentStore.getState().agentMap['agent-1'] as { files?: FileItem[] } | undefined)?.files?.[
      index
    ]?.content;

  it('parses an enabled file with no cached content and stores the result', async () => {
    vi.mocked(ragService.parseFileContent).mockResolvedValue({ content: 'parsed body' } as any);
    mountFiles([knowledgeFile({ enabled: true })]);

    await useAgentStore.getState().ensureAgentFileContents('agent-1');

    expect(ragService.parseFileContent).toHaveBeenCalledWith('file-1');
    expect(contentOf(0)).toBe('parsed body');
  });

  it('stores an empty string when the parsed document carries no content', async () => {
    vi.mocked(ragService.parseFileContent).mockResolvedValue({ content: null } as any);
    mountFiles([knowledgeFile({ enabled: true })]);

    await useAgentStore.getState().ensureAgentFileContents('agent-1');

    expect(contentOf(0)).toBe('');
  });

  it('leaves a cached parse alone, including an empty one', async () => {
    mountFiles([
      knowledgeFile({ content: 'cached', enabled: true, id: 'file-1' }),
      knowledgeFile({ content: '', enabled: true, id: 'file-2' }),
    ]);

    await useAgentStore.getState().ensureAgentFileContents('agent-1');

    expect(ragService.parseFileContent).not.toHaveBeenCalled();
    expect(contentOf(0)).toBe('cached');
    expect(contentOf(1)).toBe('');
  });

  it('skips disabled files and media that has no text to extract', async () => {
    mountFiles([
      knowledgeFile({ enabled: false, id: 'disabled' }),
      knowledgeFile({ enabled: true, id: 'image', type: 'image/png' }),
      knowledgeFile({ enabled: true, id: 'audio', type: 'audio/mpeg' }),
      knowledgeFile({ enabled: true, id: 'video', type: 'video/mp4' }),
    ]);

    await useAgentStore.getState().ensureAgentFileContents('agent-1');

    expect(ragService.parseFileContent).not.toHaveBeenCalled();
  });

  it('shares one parse per file id when a second send starts before the first settles', async () => {
    let settle: (document: { content: string }) => void = () => {};
    vi.mocked(ragService.parseFileContent).mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }) as any,
    );
    mountFiles([knowledgeFile({ enabled: true })]);

    const first = useAgentStore.getState().ensureAgentFileContents('agent-1');
    const second = useAgentStore.getState().ensureAgentFileContents('agent-1');
    settle({ content: 'parsed once' });
    await Promise.all([first, second]);

    expect(ragService.parseFileContent).toHaveBeenCalledTimes(1);
    expect(contentOf(0)).toBe('parsed once');
  });

  it('does not re-parse a file that landed while another was still parsing', async () => {
    let settleSlow: (document: { content: string }) => void = () => {};
    vi.mocked(ragService.parseFileContent).mockImplementation((async (id: string) => {
      if (id === 'slow') {
        return new Promise((resolve) => {
          settleSlow = resolve;
        });
      }

      return { content: 'fast body' };
    }) as any);
    mountFiles([
      knowledgeFile({ enabled: true, id: 'fast' }),
      knowledgeFile({ enabled: true, id: 'slow' }),
    ]);

    const first = useAgentStore.getState().ensureAgentFileContents('agent-1');
    await vi.waitFor(() => expect(contentOf(0)).toBe('fast body'));
    const second = useAgentStore.getState().ensureAgentFileContents('agent-1');
    settleSlow({ content: 'slow body' });
    await Promise.all([first, second]);

    expect(ragService.parseFileContent).toHaveBeenCalledTimes(2);
    expect(contentOf(0)).toBe('fast body');
    expect(contentOf(1)).toBe('slow body');
  });

  it('keeps the remaining files when one parse fails and never rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(ragService.parseFileContent).mockImplementation((async (id: string) => {
      if (id === 'broken') throw new Error('unsupported');

      return { content: 'parsed body' };
    }) as any);
    mountFiles([
      knowledgeFile({ enabled: true, id: 'broken' }),
      knowledgeFile({ enabled: true, id: 'file-2' }),
    ]);

    await expect(useAgentStore.getState().ensureAgentFileContents('agent-1')).resolves.toEqual(
      new Map([['broken', 'The file is attached but its contents could not be extracted.']]),
    );

    expect(contentOf(0)).toBeUndefined();
    expect(contentOf(1)).toBe('parsed body');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('skips hydration when the operation targets a different agent', async () => {
    mountFiles([knowledgeFile({ enabled: true })]);

    await useAgentStore.getState().ensureAgentFileContents('agent-2');

    expect(ragService.parseFileContent).not.toHaveBeenCalled();
    expect(contentOf(0)).toBeUndefined();
  });

  it('stops waiting when the send is aborted, without reporting a failure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // The parse never settles on its own: only the caller's signal can end this
    // wait, which is what the assertion below is about.
    let settle: (document: { content: string }) => void = () => {};
    vi.mocked(ragService.parseFileContent).mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }) as any,
    );
    mountFiles([knowledgeFile({ enabled: true, id: 'aborted-alone' })]);

    const controller = new AbortController();
    const pending = useAgentStore.getState().ensureAgentFileContents('agent-1', controller.signal);
    controller.abort();

    await expect(pending).resolves.toEqual(new Map());
    expect(contentOf(0)).toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    settle({ content: 'late body' });
  });

  it('stops listening on the send signal once the parse settles', async () => {
    vi.mocked(ragService.parseFileContent).mockResolvedValue({ content: 'parsed body' } as any);
    mountFiles([knowledgeFile({ enabled: true, id: 'listener' })]);

    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');

    await useAgentStore.getState().ensureAgentFileContents('agent-1', controller.signal);

    // A send that finishes normally must not leave its abort listener behind on
    // a signal that outlives the parse.
    await vi.waitFor(() =>
      expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function)),
    );
    removeListener.mockRestore();
  });

  it('does not wait at all when the send was aborted before hydration ran', async () => {
    mountFiles([knowledgeFile({ enabled: true, id: 'pre-aborted' })]);

    const controller = new AbortController();
    controller.abort();

    await expect(
      useAgentStore.getState().ensureAgentFileContents('agent-1', controller.signal),
    ).resolves.toEqual(new Map());
    expect(contentOf(0)).toBeUndefined();
    expect(ragService.parseFileContent).not.toHaveBeenCalled();
  });

  it('releases a send that aborts while another send waits on the same parse', async () => {
    let settle: (document: { content: string }) => void = () => {};
    vi.mocked(ragService.parseFileContent).mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }) as any,
    );
    mountFiles([knowledgeFile({ enabled: true, id: 'shared-abort' })]);

    const firstSend = new AbortController();
    const secondSend = new AbortController();
    const first = useAgentStore.getState().ensureAgentFileContents('agent-1', firstSend.signal);
    const second = useAgentStore.getState().ensureAgentFileContents('agent-1', secondSend.signal);

    secondSend.abort();

    // Resolves while the shared parse is still pending: the second send waits on
    // a promise the first one created, so only its own signal can release it.
    await expect(second).resolves.toEqual(new Map());
    expect(contentOf(0)).toBeUndefined();

    settle({ content: 'parsed body' });
    await expect(first).resolves.toEqual(new Map());
    expect(contentOf(0)).toBe('parsed body');
    expect(ragService.parseFileContent).toHaveBeenCalledTimes(1);
  });

  it('does not let one send cancel the parse another send is waiting on', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let settle: (document: { content: string }) => void = () => {};
    vi.mocked(ragService.parseFileContent).mockImplementation(
      ((_id: string, _skipExist?: boolean, signal?: AbortSignal) =>
        new Promise((resolve, reject) => {
          settle = resolve;
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })) as any,
    );
    mountFiles([knowledgeFile({ enabled: true, id: 'shared-alive' })]);

    const firstSend = new AbortController();
    const first = useAgentStore.getState().ensureAgentFileContents('agent-1', firstSend.signal);
    const second = useAgentStore.getState().ensureAgentFileContents('agent-1');

    firstSend.abort();
    await expect(first).resolves.toEqual(new Map());

    settle({ content: 'parsed body' });
    await expect(second).resolves.toEqual(new Map());

    expect(ragService.parseFileContent).toHaveBeenCalledWith('shared-alive');
    expect(contentOf(0)).toBe('parsed body');
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('keeps the shared parse in flight when the send that started it aborts', async () => {
    let settle: (document: { content: string }) => void = () => {};
    vi.mocked(ragService.parseFileContent).mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }) as any,
    );
    mountFiles([knowledgeFile({ enabled: true, id: 'shared-inflight' })]);

    const firstSend = new AbortController();
    const aborted = useAgentStore.getState().ensureAgentFileContents('agent-1', firstSend.signal);
    firstSend.abort();
    await expect(aborted).resolves.toEqual(new Map());

    // A send that arrives after the abort must join the parse already running
    // rather than start a second one for the same file.
    const next = useAgentStore.getState().ensureAgentFileContents('agent-1');
    settle({ content: 'parsed body' });
    await expect(next).resolves.toEqual(new Map());

    expect(ragService.parseFileContent).toHaveBeenCalledTimes(1);
    expect(contentOf(0)).toBe('parsed body');
  });

  it('skips a file with no id, which has no document to parse under', async () => {
    mountFiles([{ ...knowledgeFile({ enabled: true }), id: undefined } as any]);

    await useAgentStore.getState().ensureAgentFileContents('agent-1');

    expect(ragService.parseFileContent).not.toHaveBeenCalled();
  });

  it('keeps a late parse scoped to requesting agents whose mount is still enabled', async () => {
    const parse = Promise.withResolvers<{ content: string }>();
    vi.mocked(ragService.parseFileContent).mockReturnValue(parse.promise as any);
    const file = knowledgeFile({ enabled: true, id: 'shared-across-agents' });
    mountFiles([file]);
    const controller = new AbortController();
    const wait = useAgentStore.getState().ensureAgentFileContents('agent-1', controller.signal);
    controller.abort();
    await wait;
    useAgentStore.setState({
      activeAgentId: 'agent-2',
      agentMap: {
        'agent-1': { files: [{ ...file, enabled: false }] },
        'agent-2': { files: [file] },
      } as any,
    });

    parse.resolve({ content: 'late body' });
    await parse.promise;

    for (const agent of Object.values(useAgentStore.getState().agentMap)) {
      expect((agent as LobeAgentConfig).files?.[0].content).toBeUndefined();
    }
  });

  it('does nothing when no agent is active', async () => {
    useAgentStore.setState({
      activeAgentId: undefined,
      agentMap: { 'agent-1': { files: [knowledgeFile({ enabled: true })] } as any },
    });

    await useAgentStore.getState().ensureAgentFileContents('agent-1');

    expect(ragService.parseFileContent).not.toHaveBeenCalled();
  });
});
