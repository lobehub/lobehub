import { describe, expect, it, vi } from 'vitest';

import {
  buildOperationInitRequest,
  type OperationInitRequest,
  rehydrateDetachedFileContent,
  toPersistedInitRequest,
} from '../operationInit';

const fullInput = (): Parameters<typeof buildOperationInitRequest>[0] => ({
  additionalPluginIds: ['lobe-task'],
  agentSlug: 'my-agent',
  approvalOwnerAssistantId: 'msg-assistant',
  // A batch approval resume: the claim pairs each decision with its plugin row
  // and a `createdAt` used only to order the batch.
  approvedToolEntries: [
    {
      createdAt: new Date('2026-09-20T10:00:00.000Z'),
      plugin: {
        apiName: 'runCommand',
        arguments: '{"command":"ls"}',
        identifier: 'lobe-local-system',
        toolCallId: 'call-1',
        type: 'default',
      },
      toolMessageId: 'msg-tool-1',
    },
  ] as any,
  attachedFileIds: ['file-1'],
  disableLocalSystem: false,
  disableSelfFeedbackIntentTool: false,
  disableTools: false,
  ephemeralUserMessage: 'ephemeral',
  exclusivePluginIds: undefined,
  files: [
    { content: new ArrayBuffer(8), mimeType: 'image/png', name: 'a.png' },
    { content: new ArrayBuffer(8), name: 'unknown.bin' },
  ] as any,
  functionTools: [{ function: { name: 'client_fn' }, type: 'function' }] as any,
  globalMemoryEnabled: true,
  hasMentionedAgents: true,
  isFixedDeviceTarget: false,
  localDeviceId: 'device-1',
  mentionedAgents: [{ id: 'agt_2', name: 'Fox' }],
  parentMessageId: 'msg-parent',
  requestTrigger: 'chat' as any,
  requestedDeviceId: 'device-2',
  resumeApproval: undefined,
  resumeApprovalPlugin: undefined,
  resumeApprovals: undefined,
  resumeFromHistory: false,
  resumeToolResult: undefined,
  runAttachments: {
    fileIds: ['file-1'],
    imageList: [{ alt: 'image', id: 'file-1', url: 'https://example.com/a.png' }],
    warnings: [],
  },
  selectedToolIds: ['lobe-web-browsing'],
  topicBoundDeviceId: null,
});

describe('buildOperationInitRequest', () => {
  it('reduces the raw uploads to the mime types discovery actually reads', () => {
    const request = buildOperationInitRequest(fullInput());

    expect(request.externalFileTypes).toEqual(['image/png', '']);
    expect('files' in request).toBe(false);
  });

  it('keeps only what the resume context reads from an approved batch entry', () => {
    const request = buildOperationInitRequest(fullInput());

    expect(request.approvedToolEntries).toEqual([
      {
        plugin: {
          apiName: 'runCommand',
          arguments: '{"command":"ls"}',
          identifier: 'lobe-local-system',
          toolCallId: 'call-1',
          type: 'default',
        },
        toolMessageId: 'msg-tool-1',
      },
    ]);
    // The claim's ordering key is a `Date`; JSON would flatten it to a string.
    expect('createdAt' in request.approvedToolEntries[0]).toBe(false);
  });

  // A deferred init has to carry this request on the operation
  // state through Redis, which is JSON. A `Date`, a `Buffer` or a model instance
  // sneaking into the request would survive the send path and silently degrade
  // there, so hold the line here instead.
  it('stays JSON-safe end to end', () => {
    const request = buildOperationInitRequest(fullInput());

    // eslint-disable-next-line unicorn/prefer-structured-clone
    const roundTripped = JSON.parse(JSON.stringify(request)) as OperationInitRequest;

    expect(roundTripped).toEqual(request);
  });
});

describe('persisted init request', () => {
  const withDocuments = (): OperationInitRequest =>
    buildOperationInitRequest({
      ...fullInput(),
      runAttachments: {
        fileList: [
          {
            content: 'x'.repeat(1024),
            fileType: 'application/pdf',
            id: 'file-parsed',
            name: 'a.pdf',
            size: 1,
            url: 'u',
          },
          { fileType: 'application/pdf', id: 'file-unparsed', name: 'b.pdf', size: 1, url: 'u' },
        ] as any,
        warnings: [],
      },
    });

  // A parsed attachment can run to tens of MB; the state is one Redis write.
  it('leaves parsed bodies in the documents table and records which ones', () => {
    const persisted = toPersistedInitRequest(withDocuments());

    expect(persisted.runAttachments.fileList?.every((file) => file.content === undefined)).toBe(
      true,
    );
    expect(persisted.detachedFileContentIds).toEqual(['file-parsed']);
  });

  it('reads back only the bodies it detached', async () => {
    const readFileContent = vi.fn(async (fileId: string) => `body of ${fileId}`);

    const restored = await rehydrateDetachedFileContent(
      toPersistedInitRequest(withDocuments()),
      readFileContent,
    );

    expect(restored.runAttachments.fileList?.map((file) => file.content)).toEqual([
      'body of file-parsed',
      undefined,
    ]);
    // The file whose parse failed at turn setup must not be re-parsed here.
    expect(readFileContent).toHaveBeenCalledTimes(1);
    expect('detachedFileContentIds' in restored).toBe(false);
  });
});
