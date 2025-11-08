import { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { ChatStoreState } from '@/store/chat';

import { chatPortalSelectors } from './selectors';

describe('chatDockSelectors', () => {
  const createState = (overrides?: Partial<ChatStoreState>) => {
    const state = {
      showPortal: false,
      portalToolMessage: undefined,
      messagesMap: {},
      activeId: 'test-id',
      activeTopicId: undefined,
      ...overrides,
    } as ChatStoreState;

    return state;
  };

  describe('showDock', () => {
    it('should return the showDock state', () => {
      expect(chatPortalSelectors.showPortal(createState({ showPortal: true }))).toBe(true);
      expect(chatPortalSelectors.showPortal(createState({ showPortal: false }))).toBe(false);
    });
  });

  describe('toolUIMessageId', () => {
    it('should return undefined when dockToolMessage is not set', () => {
      expect(chatPortalSelectors.toolMessageId(createState())).toBeUndefined();
    });

    it('should return the id when dockToolMessage is set', () => {
      const state = createState({ portalToolMessage: { id: 'test-id', identifier: 'test' } });
      expect(chatPortalSelectors.toolMessageId(state)).toBe('test-id');
    });
  });

  describe('isMessageToolUIOpen', () => {
    it('should return false when id does not match or showDock is false', () => {
      const state = createState({
        portalToolMessage: { id: 'test-id', identifier: 'test' },
        showPortal: false,
      });
      expect(chatPortalSelectors.isPluginUIOpen('test-id')(state)).toBe(false);
      expect(chatPortalSelectors.isPluginUIOpen('other-id')(state)).toBe(false);
    });

    it('should return true when id matches and showDock is true', () => {
      const state = createState({
        portalToolMessage: { id: 'test-id', identifier: 'test' },
        showPortal: true,
      });
      expect(chatPortalSelectors.isPluginUIOpen('test-id')(state)).toBe(true);
    });
  });

  describe('showToolUI', () => {
    it('should return false when dockToolMessage is not set', () => {
      expect(chatPortalSelectors.showPluginUI(createState())).toBe(false);
    });

    it('should return true when dockToolMessage is set', () => {
      const state = createState({ portalToolMessage: { id: 'test-id', identifier: 'test' } });
      expect(chatPortalSelectors.showPluginUI(state)).toBe(true);
    });
  });

  describe('toolUIIdentifier', () => {
    it('should return undefined when dockToolMessage is not set', () => {
      expect(chatPortalSelectors.toolUIIdentifier(createState())).toBeUndefined();
    });

    it('should return the identifier when dockToolMessage is set', () => {
      const state = createState({ portalToolMessage: { id: 'test-id', identifier: 'test' } });
      expect(chatPortalSelectors.toolUIIdentifier(state)).toBe('test');
    });
  });

  describe('showFilePreview', () => {
    it('should return false when portalFile is not set', () => {
      expect(chatPortalSelectors.showFilePreview(createState())).toBe(false);
    });

    it('should return true when portalFile is set', () => {
      const state = createState({ portalFile: { fileId: 'file-id', chunkText: 'chunk' } });
      expect(chatPortalSelectors.showFilePreview(state)).toBe(true);
    });
  });

  describe('previewFileId', () => {
    it('should return undefined when portalFile is not set', () => {
      expect(chatPortalSelectors.previewFileId(createState())).toBeUndefined();
    });

    it('should return the fileId when portalFile is set', () => {
      const state = createState({ portalFile: { fileId: 'file-id', chunkText: 'chunk' } });
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
        messagesMap: {
          'test-id_null': [
            {
              id: 'test-id',
              content: messageContent,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              role: 'user',
              meta: {},
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
              meta: {},
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
        messagesMap: {
          'test-id_null': [
            {
              id: 'test-id',
              content: `<lobeArtifact type="text">${artifactContent}</lobeArtifact>`,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              role: 'user',
              meta: {},
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
        messagesMap: {
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
              meta: {},
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
        messagesMap: {
          'test-id_null': [
            {
              id: 'test-id',
              content: '<lobeArtifact type="text">Test content',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              role: 'user',
              meta: {},
              sessionId: 'test-id',
            } as UIChatMessage,
          ],
        },
      });
      expect(chatPortalSelectors.isArtifactTagClosed('test-id')(state)).toBe(false);
    });

    it('should return true for closed artifact tag', () => {
      const state = createState({
        messagesMap: {
          'test-id_null': [
            {
              id: 'test-id',
              content: '<lobeArtifact type="text">Test content</lobeArtifact>',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              role: 'user',
              meta: {},
              sessionId: 'test-id',
            } as UIChatMessage,
          ],
        },
      });
      expect(chatPortalSelectors.isArtifactTagClosed('test-id')(state)).toBe(true);
    });

    it('should return false when no artifact tag exists', () => {
      const state = createState({
        messagesMap: {
          'test-id_null': [
            {
              id: 'test-id',
              content: 'No artifact tag here',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              role: 'user',
              meta: {},
              sessionId: 'test-id',
            } as UIChatMessage,
          ],
        },
      });
      expect(chatPortalSelectors.isArtifactTagClosed('test-id')(state)).toBe(false);
    });
  });
});
