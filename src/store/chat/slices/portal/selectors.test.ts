import { type UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { type ChatStoreState } from '@/store/chat';

import { PortalViewType } from './initialState';
import { chatPortalSelectors } from './selectors';

describe('chatDockSelectors', () => {
  const createState = (overrides?: Partial<ChatStoreState>) => {
    const state = {
      showPortal: false,
      portalToolMessage: undefined,
      portalStack: [],
      dbMessagesMap: {},
      activeAgentId: 'test-id',
      activeTopicId: undefined,
      ...overrides,
    } as ChatStoreState;

    return state;
  };

  describe('currentView', () => {
    it('should return null when stack is empty', () => {
      expect(chatPortalSelectors.currentView(createState())).toBeNull();
    });

    it('should return the top view from stack', () => {
      const state = createState({
        portalStack: [
          { type: PortalViewType.Notebook },
          { type: PortalViewType.Document, documentId: 'doc-1' },
        ],
      });
      expect(chatPortalSelectors.currentView(state)).toEqual({
        type: PortalViewType.Document,
        documentId: 'doc-1',
      });
    });
  });

  describe('currentViewType', () => {
    it('should return null when stack is empty', () => {
      expect(chatPortalSelectors.currentViewType(createState())).toBeNull();
    });

    it('should return the type of top view', () => {
      const state = createState({
        portalStack: [{ type: PortalViewType.Notebook }],
      });
      expect(chatPortalSelectors.currentViewType(state)).toBe(PortalViewType.Notebook);
    });
  });

  describe('canGoBack', () => {
    it('should return false when stack has 0 or 1 views', () => {
      expect(chatPortalSelectors.canGoBack(createState())).toBe(false);
      expect(
        chatPortalSelectors.canGoBack(
          createState({ portalStack: [{ type: PortalViewType.Notebook }] }),
        ),
      ).toBe(false);
    });

    it('should return true when stack has more than 1 view', () => {
      const state = createState({
        portalStack: [
          { type: PortalViewType.Notebook },
          { type: PortalViewType.Document, documentId: 'doc-1' },
        ],
      });
      expect(chatPortalSelectors.canGoBack(state)).toBe(true);
    });
  });

  describe('showArtifactUI', () => {
    it('should return false when current view is not Artifact', () => {
      expect(chatPortalSelectors.showArtifactUI(createState())).toBe(false);
      expect(
        chatPortalSelectors.showArtifactUI(
          createState({ portalStack: [{ type: PortalViewType.Notebook }] }),
        ),
      ).toBe(false);
    });

    it('should return true when current view is Artifact', () => {
      const state = createState({
        portalStack: [
          {
            type: PortalViewType.Artifact,
            artifact: { id: 'test', title: 'Test', type: 'text' },
          },
        ],
      });
      expect(chatPortalSelectors.showArtifactUI(state)).toBe(true);
    });
  });

  describe('showDock', () => {
    it('should return the showDock state', () => {
      expect(chatPortalSelectors.showPortal(createState({ showPortal: true }))).toBe(true);
      expect(chatPortalSelectors.showPortal(createState({ showPortal: false }))).toBe(false);
    });
  });

  describe('toolUIMessageId', () => {
    it('should return undefined when no ToolUI view on stack', () => {
      expect(chatPortalSelectors.toolMessageId(createState())).toBeUndefined();
    });

    it('should return the messageId when ToolUI view is on stack', () => {
      const state = createState({
        portalStack: [{ type: PortalViewType.ToolUI, messageId: 'test-id', identifier: 'test' }],
      });
      expect(chatPortalSelectors.toolMessageId(state)).toBe('test-id');
    });
  });

  describe('isMessageToolUIOpen', () => {
    it('should return false when id does not match or showDock is false', () => {
      const state = createState({
        portalStack: [{ type: PortalViewType.ToolUI, messageId: 'test-id', identifier: 'test' }],
        showPortal: false,
      });
      expect(chatPortalSelectors.isPluginUIOpen('test-id')(state)).toBe(false);
      expect(chatPortalSelectors.isPluginUIOpen('other-id')(state)).toBe(false);
    });

    it('should return true when id matches and showDock is true', () => {
      const state = createState({
        portalStack: [{ type: PortalViewType.ToolUI, messageId: 'test-id', identifier: 'test' }],
        showPortal: true,
      });
      expect(chatPortalSelectors.isPluginUIOpen('test-id')(state)).toBe(true);
    });
  });

  describe('showToolUI', () => {
    it('should return false when no ToolUI view on stack', () => {
      expect(chatPortalSelectors.showPluginUI(createState())).toBe(false);
    });

    it('should return true when ToolUI view is on stack', () => {
      const state = createState({
        portalStack: [{ type: PortalViewType.ToolUI, messageId: 'test-id', identifier: 'test' }],
      });
      expect(chatPortalSelectors.showPluginUI(state)).toBe(true);
    });
  });

  describe('toolUIIdentifier', () => {
    it('should return undefined when no ToolUI view on stack', () => {
      expect(chatPortalSelectors.toolUIIdentifier(createState())).toBeUndefined();
    });

    it('should return the identifier when ToolUI view is on stack', () => {
      const state = createState({
        portalStack: [{ type: PortalViewType.ToolUI, messageId: 'test-id', identifier: 'test' }],
      });
      expect(chatPortalSelectors.toolUIIdentifier(state)).toBe('test');
    });
  });

  describe('showFilePreview', () => {
    it('should return false when no FilePreview view on stack', () => {
      expect(chatPortalSelectors.showFilePreview(createState())).toBe(false);
    });

    it('should return true when FilePreview view is on stack', () => {
      const state = createState({
        portalStack: [
          { type: PortalViewType.FilePreview, file: { fileId: 'file-id', chunkText: 'chunk' } },
        ],
      });
      expect(chatPortalSelectors.showFilePreview(state)).toBe(true);
    });
  });

  describe('previewFileId', () => {
    it('should return undefined when no FilePreview view on stack', () => {
      expect(chatPortalSelectors.previewFileId(createState())).toBeUndefined();
    });

    it('should return the fileId when FilePreview view is on stack', () => {
      const state = createState({
        portalStack: [
          { type: PortalViewType.FilePreview, file: { fileId: 'file-id', chunkText: 'chunk' } },
        ],
      });
      expect(chatPortalSelectors.previewFileId(state)).toBe('file-id');
    });
  });

  describe('artifactMessageContent', () => {
    it('should return empty string when message not found', () => {
      const state = createState();
      expect(chatPortalSelectors.artifactMessageContent('non-existent-id')(state)).toBe('');
    });

    it('should return message content when message exists', () => {
      const messageContent = 'Test message content';
      const state = createState({
        dbMessagesMap: {
          'test-id_null': [
            {
              id: 'test-id',
              content: messageContent,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              role: 'user',
              sessionId: 'test-id',
            } as UIChatMessage,
          ],
        },
      });
      expect(chatPortalSelectors.artifactMessageContent('test-id')(state)).toBe(messageContent);
    });
  });

  describe('artifactCode', () => {
    it('should return empty string when no artifact tag found', () => {
      const state = createState({
        messagesMap: {
          'test-id_null': [
            {
              id: 'test-id',
              content: 'No artifact tag here',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              role: 'user',
              sessionId: 'test-id',
            } as UIChatMessage,
          ],
        },
      });
      expect(chatPortalSelectors.artifactCode('test-id')(state)).toBe('');
    });

    it('should extract content from artifact tag', () => {
      const artifactContent = 'Test artifact content';
      const state = createState({
        dbMessagesMap: {
          'test-id_null': [
            {
              id: 'test-id',
              content: `<lobeArtifact type="text">${artifactContent}</lobeArtifact>`,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              role: 'user',
              sessionId: 'test-id',
            } as UIChatMessage,
          ],
        },
      });
      expect(chatPortalSelectors.artifactCode('test-id')(state)).toBe(artifactContent);
    });

    it('should remove markdown code block wrapping HTML content', () => {
      const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <title>Test</title>
</head>
<body>
  <div>Test content</div>
</body>
</html>`;
      const state = createState({
        dbMessagesMap: {
          'test-id_null': [
            {
              id: 'test-id',
              content: `<lobeArtifact type="text/html">
\`\`\`html
${htmlContent}
\`\`\`
</lobeArtifact>`,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              role: 'user',
              sessionId: 'test-id',
            } as UIChatMessage,
          ],
        },
      });
      expect(chatPortalSelectors.artifactCode('test-id')(state)).toBe(htmlContent);
    });
  });

  describe('isArtifactTagClosed', () => {
    it('should return false for unclosed artifact tag', () => {
      const state = createState({
        dbMessagesMap: {
          'test-id_null': [
            {
              id: 'test-id',
              content: '<lobeArtifact type="text">Test content',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              role: 'user',
              sessionId: 'test-id',
            } as UIChatMessage,
          ],
        },
      });
      expect(chatPortalSelectors.isArtifactTagClosed('test-id')(state)).toBe(false);
    });

    it('should return true for closed artifact tag', () => {
      const state = createState({
        dbMessagesMap: {
          'test-id_null': [
            {
              id: 'test-id',
              content: '<lobeArtifact type="text">Test content</lobeArtifact>',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              role: 'user',
              sessionId: 'test-id',
            } as UIChatMessage,
          ],
        },
      });
      expect(chatPortalSelectors.isArtifactTagClosed('test-id')(state)).toBe(true);
    });

    it('should return false when no artifact tag exists', () => {
      const state = createState({
        dbMessagesMap: {
          'test-id_null': [
            {
              id: 'test-id',
              content: 'No artifact tag here',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              role: 'user',
              sessionId: 'test-id',
            } as UIChatMessage,
          ],
        },
      });
      expect(chatPortalSelectors.isArtifactTagClosed('test-id')(state)).toBe(false);
    });
  });
});
