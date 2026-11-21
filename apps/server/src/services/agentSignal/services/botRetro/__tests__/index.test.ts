// @vitest-environment node
import { PolicyLoad } from '@lobechat/agent-templates';
import { TRACING_SCENARIOS } from '@lobechat/const';
import { BOT_RETRO_JSON_SCHEMA, BOT_RETRO_PROMPT_VERSION } from '@lobechat/prompts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentDocumentVfsError } from '@/server/services/agentDocumentVfs/errors';

import {
  BOT_LESSONS_FILENAME,
  BOT_REFLECTION_FOLDER,
  BOT_RETRO_LOG_FILENAME,
  renderBotLessons,
} from '../documents';
import { BotRetroService, toBotRetroVent } from '../index';

const mocks = vi.hoisted(() => ({
  createFolder: vi.fn(),
  generateObject: vi.fn(),
  getAgentMeta: vi.fn(),
  getDocumentByFilename: vi.fn(),
  listBotTopics: vi.fn(),
  listOwnerWakeMarks: vi.fn(),
  listVents: vi.fn(),
  moveDocuments: vi.fn(),
  upsertDocument: vi.fn(),
  upsertDocumentByFilename: vi.fn(),
}));

vi.mock('@/database/models/agentSignal/botRetro', () => ({
  AgentBotRetroModel: class {
    getAgentMeta = mocks.getAgentMeta;
    listBotActiveAgents = vi.fn();
    listBotTopics = mocks.listBotTopics;
    listOwnerWakeMarks = mocks.listOwnerWakeMarks;
    listVents = mocks.listVents;
  },
}));

vi.mock('@/server/services/agentDocuments', () => ({
  AgentDocumentsService: class {
    createFolder = mocks.createFolder;
    getDocumentByFilename = mocks.getDocumentByFilename;
    moveDocuments = mocks.moveDocuments;
    upsertDocument = mocks.upsertDocument;
    upsertDocumentByFilename = mocks.upsertDocumentByFilename;
  },
}));

vi.mock('@/server/services/aiGeneration', () => ({
  AiGenerationService: class {
    generateObject = mocks.generateObject;
  },
}));

const input = {
  agentId: 'agent-1',
  localDate: '2026-11-01',
  windowEnd: new Date('2026-11-02T00:00:00.000Z'),
  windowStart: new Date('2026-11-01T00:00:00.000Z'),
};

const topic = {
  assistantMessageCount: 3,
  failedMessages: [],
  failedToolCalls: [{ apiName: 'search', errorSummary: '500', identifier: 'web-search' }],
  lastActivityAt: new Date('2026-11-01T12:00:00.000Z'),
  messageCount: 6,
  platform: 'discord',
  summary: 'deploy help',
  title: 'deploy thread',
  topicId: 'tpc-1',
};

const ventRow = {
  arguments: '{"category":"platform_bug","severity":"high","summary":"search 500s"}',
  createdAt: new Date('2026-11-01T12:00:00.000Z'),
  messageId: 'msg-vent',
  state: { recorded: true },
  topicId: 'tpc-1',
};

const files = (docs: Record<string, string | undefined>) =>
  mocks.getDocumentByFilename.mockImplementation(async (_agentId: string, filename: string) =>
    docs[filename] === undefined ? undefined : { content: docs[filename] },
  );

describe('BotRetroService.runForAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listBotTopics.mockResolvedValue([topic]);
    mocks.listVents.mockResolvedValue([ventRow]);
    mocks.listOwnerWakeMarks.mockResolvedValue([
      { label: 'false_wake', outcome: 'wake', reason: null, topicId: 'tpc-1' },
    ]);
    mocks.getAgentMeta.mockResolvedValue({ description: null, title: 'Shadow' });
    files({});
    mocks.upsertDocument.mockImplementation(async ({ filename }) => ({ id: `row-${filename}` }));
    mocks.moveDocuments.mockResolvedValue([{ id: 'row', status: 'moved' }]);
    mocks.createFolder.mockResolvedValue({
      created: true,
      folder: { documentId: 'docs_folder' },
    });
  });

  it('skips a day the log already holds, before reading or calling the model', async () => {
    files({ [BOT_RETRO_LOG_FILENAME]: '# Bot retro log\n\n## 2026-11-01\n\nDone.' });

    const outcome = await new BotRetroService({} as never, 'user-1').runForAgent(input);

    expect(outcome).toEqual({ reason: 'already_reviewed', status: 'skipped' });
    expect(mocks.listBotTopics).not.toHaveBeenCalled();
    expect(mocks.generateObject).not.toHaveBeenCalled();
    expect(mocks.createFolder).not.toHaveBeenCalled();
  });

  it('skips an agent with no bot conversation in the window', async () => {
    mocks.listBotTopics.mockResolvedValue([]);

    const outcome = await new BotRetroService({} as never, 'user-1').runForAgent(input);

    expect(outcome).toEqual({ reason: 'no_bot_activity', status: 'skipped' });
    expect(mocks.generateObject).not.toHaveBeenCalled();
    expect(mocks.createFolder).not.toHaveBeenCalled();
  });

  it('splits platform issues from own mistakes and writes both documents into the folder', async () => {
    mocks.generateObject.mockResolvedValue({
      lessons: ['Reply only when addressed or clearly invited'],
      platformIssues: [
        { detail: 'web search returned 500', title: 'search down', ventId: 'msg-vent' },
        { detail: 'cannot edit a sent message', title: 'no edit tool', ventId: 'made-up' },
      ],
      selfMistakes: [
        {
          lesson: 'Reply only when addressed or clearly invited',
          topicId: 'tpc-1',
          what: 'Jumped into a conversation between two people',
        },
      ],
      summary: 'Busy day with one bad wake.',
    });

    const outcome = await new BotRetroService({} as never, 'user-1').runForAgent(input);

    expect(outcome).toEqual({
      lessonCount: 1,
      platformIssueCount: 2,
      selfMistakeCount: 1,
      status: 'written',
    });

    const [request, options] = mocks.generateObject.mock.calls[0];
    expect(request.schema).toBe(BOT_RETRO_JSON_SCHEMA);
    const prompt = request.messages[1].content as string;
    expect(prompt).toContain('ventId msg-vent · platform_bug/high');
    expect(prompt).toContain('- false_wake (you woke) · topicId tpc-1');
    expect(prompt).toContain('failed tool web-search/search: 500');
    expect(options.tracing).toMatchObject({
      agentId: 'agent-1',
      promptVersion: BOT_RETRO_PROMPT_VERSION,
      scenario: TRACING_SCENARIOS.BotRetro,
      schemaName: BOT_RETRO_JSON_SCHEMA.name,
    });

    expect(mocks.upsertDocument).toHaveBeenCalledWith({
      agentId: 'agent-1',
      content: renderBotLessons(['Reply only when addressed or clearly invited']),
      filename: BOT_LESSONS_FILENAME,
      policyLoad: PolicyLoad.ALWAYS,
    });
    expect(mocks.createFolder).toHaveBeenCalledTimes(1);
    expect(mocks.createFolder).toHaveBeenCalledWith('agent-1', BOT_REFLECTION_FOLDER);
    expect(mocks.moveDocuments.mock.calls).toEqual([
      ['agent-1', [`row-${BOT_LESSONS_FILENAME}`], 'docs_folder'],
      ['agent-1', [`row-${BOT_RETRO_LOG_FILENAME}`], 'docs_folder'],
    ]);

    const logWrite = mocks.upsertDocument.mock.calls.find(
      ([call]) => call.filename === BOT_RETRO_LOG_FILENAME,
    )![0];
    expect(logWrite.policyLoad).toBe(PolicyLoad.DISABLED);
    expect(logWrite.content).toContain('- [vented] **search down**');
    // A vent id the agent never filed does not count as reported.
    expect(logWrite.content).toContain('- [not vented] **no edit tool**');
    expect(logWrite.content).toContain(
      '- Jumped into a conversation between two people → next time: Reply only when addressed or clearly invited',
    );
  });

  it('keeps existing lessons on a quiet day and updates existing documents in place', async () => {
    const existingLessons = renderBotLessons(['Confirm the thread first']);
    files({
      [BOT_LESSONS_FILENAME]: existingLessons,
      [BOT_RETRO_LOG_FILENAME]: '# Bot retro log\n\n## 2026-10-31\n\nQuiet.',
    });
    mocks.generateObject.mockResolvedValue({
      lessons: [],
      platformIssues: [],
      selfMistakes: [],
      summary: 'Nothing went wrong.',
    });

    await new BotRetroService({} as never, 'user-1').runForAgent(input);

    expect(mocks.generateObject.mock.calls[0][0].messages[1].content).toContain(
      '- Confirm the thread first',
    );
    expect(mocks.upsertDocument).not.toHaveBeenCalled();
    // Existing documents are updated wherever they are; nothing is created or moved.
    expect(mocks.createFolder).not.toHaveBeenCalled();
    expect(mocks.moveDocuments).not.toHaveBeenCalled();
    expect(mocks.upsertDocumentByFilename).toHaveBeenCalledTimes(1);
    const [logWrite] = mocks.upsertDocumentByFilename.mock.calls[0];
    expect(logWrite.filename).toBe(BOT_RETRO_LOG_FILENAME);
    expect(logWrite.content.indexOf('## 2026-11-01')).toBeLessThan(
      logWrite.content.indexOf('## 2026-10-31'),
    );
  });

  it('falls back to the top level when an ordinary document already has the folder name', async () => {
    mocks.createFolder.mockRejectedValue(
      new AgentDocumentVfsError('A document named "Bot Reflection" already exists', 'CONFLICT'),
    );
    mocks.generateObject.mockResolvedValue({
      lessons: ['Ask before guessing'],
      platformIssues: [],
      selfMistakes: [],
      summary: 'Fine.',
    });

    await new BotRetroService({} as never, 'user-1').runForAgent(input);

    expect(mocks.upsertDocument).toHaveBeenCalledTimes(2);
    expect(mocks.moveDocuments).not.toHaveBeenCalled();
  });

  it('does not swallow other folder failures', async () => {
    mocks.createFolder.mockRejectedValue(new Error('db down'));
    mocks.generateObject.mockResolvedValue({
      lessons: ['Ask before guessing'],
      platformIssues: [],
      selfMistakes: [],
      summary: 'Fine.',
    });

    await expect(new BotRetroService({} as never, 'user-1').runForAgent(input)).rejects.toThrow(
      'db down',
    );
    expect(mocks.moveDocuments).not.toHaveBeenCalled();
  });

  it('rejects a malformed model answer without touching the documents', async () => {
    mocks.generateObject.mockResolvedValue({ summary: 'missing lists' });

    await expect(new BotRetroService({} as never, 'user-1').runForAgent(input)).rejects.toThrow();
    expect(mocks.upsertDocument).not.toHaveBeenCalled();
    expect(mocks.upsertDocumentByFilename).not.toHaveBeenCalled();
  });
});

describe('toBotRetroVent', () => {
  it('reads the vent arguments and treats a rejected call as not recorded', () => {
    expect(toBotRetroVent(ventRow)).toEqual({
      category: 'platform_bug',
      details: undefined,
      id: 'msg-vent',
      recorded: true,
      severity: 'high',
      summary: 'search 500s',
      topicId: 'tpc-1',
    });
    expect(
      toBotRetroVent({ ...ventRow, arguments: 'not json', state: { recorded: false } }),
    ).toMatchObject({ category: undefined, id: 'msg-vent', recorded: false });
  });
});
