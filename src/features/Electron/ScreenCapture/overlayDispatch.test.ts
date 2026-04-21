import { describe, expect, it } from 'vitest';

import { type UploadFileItem } from '@/types/files/upload';

import {
  canConsumePendingOverlayDispatch,
  createOverlayDispatchScreenshotFilename,
  selectPendingOverlayDispatchFiles,
} from './overlayDispatch';

describe('overlayDispatch', () => {
  describe('canConsumePendingOverlayDispatch', () => {
    it('allows a new conversation before messages initialize', () => {
      expect(
        canConsumePendingOverlayDispatch({
          agentId: 'agent-1',
          isAgentConfigLoading: false,
          messagesInit: false,
          pendingDispatch: {
            agentId: 'agent-1',
            dispatchId: 'dispatch-1',
            prompt: 'hello',
            screenshotFileNames: ['screen-capture-dispatch-1-1.png'],
            uploadStatus: 'ready',
          },
          routeAgentId: 'agent-1',
          topicId: null,
        }),
      ).toBe(true);
    });

    it('waits for existing conversation messages to initialize', () => {
      expect(
        canConsumePendingOverlayDispatch({
          agentId: 'agent-1',
          isAgentConfigLoading: false,
          messagesInit: false,
          pendingDispatch: {
            agentId: 'agent-1',
            dispatchId: 'dispatch-1',
            prompt: 'hello',
            screenshotFileNames: ['screen-capture-dispatch-1-1.png'],
            uploadStatus: 'ready',
          },
          routeAgentId: 'agent-1',
          topicId: 'topic-1',
        }),
      ).toBe(false);
    });

    it('blocks when the route has not switched to the pending agent', () => {
      expect(
        canConsumePendingOverlayDispatch({
          agentId: 'agent-1',
          isAgentConfigLoading: false,
          messagesInit: true,
          pendingDispatch: {
            agentId: 'agent-1',
            dispatchId: 'dispatch-1',
            prompt: 'hello',
            screenshotFileNames: ['screen-capture-dispatch-1-1.png'],
            uploadStatus: 'ready',
          },
          routeAgentId: 'agent-2',
          topicId: null,
        }),
      ).toBe(false);
    });

    it('waits while screenshot upload is still in flight', () => {
      expect(
        canConsumePendingOverlayDispatch({
          agentId: 'agent-1',
          isAgentConfigLoading: false,
          messagesInit: true,
          pendingDispatch: {
            agentId: 'agent-1',
            dispatchId: 'dispatch-1',
            prompt: 'hello',
            screenshotFileNames: ['screen-capture-dispatch-1-1.png'],
            uploadStatus: 'uploading',
          },
          routeAgentId: 'agent-1',
          topicId: null,
        }),
      ).toBe(false);
    });

    it('allows consumption after upload fails so the prompt still delivers', () => {
      expect(
        canConsumePendingOverlayDispatch({
          agentId: 'agent-1',
          isAgentConfigLoading: false,
          messagesInit: true,
          pendingDispatch: {
            agentId: 'agent-1',
            dispatchId: 'dispatch-1',
            prompt: 'hello',
            screenshotFileNames: [],
            uploadStatus: 'failed',
          },
          routeAgentId: 'agent-1',
          topicId: null,
        }),
      ).toBe(true);
    });
  });

  describe('selectPendingOverlayDispatchFiles', () => {
    it('keeps only files created by the overlay dispatch and preserves capture order', () => {
      const firstFileName = createOverlayDispatchScreenshotFilename('dispatch-1', 0);
      const secondFileName = createOverlayDispatchScreenshotFilename('dispatch-1', 1);
      const fileList = [
        {
          file: new File(['b'], secondFileName, {
            type: 'image/png',
          }),
          id: 'overlay-2',
        },
        { file: new File(['a'], 'existing.png', { type: 'image/png' }), id: 'existing' },
        {
          file: new File(['c'], firstFileName, {
            type: 'image/png',
          }),
          id: 'overlay-1',
        },
      ] as UploadFileItem[];

      expect(
        selectPendingOverlayDispatchFiles({
          fileList,
          pendingDispatch: {
            agentId: 'agent-1',
            dispatchId: 'dispatch-1',
            prompt: 'hello',
            screenshotFileNames: [firstFileName, secondFileName],
            uploadStatus: 'ready',
          },
        }),
      ).toEqual([fileList[2], fileList[0]]);
    });
  });
});
