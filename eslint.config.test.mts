// @vitest-environment node

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: process.cwd() });

const lintRestrictedImports = async (filePath: string, code: string): Promise<string[]> => {
  const [result] = await eslint.lintText(code, { filePath });

  return result.messages
    .filter(({ ruleId }) => ruleId === 'no-restricted-imports')
    .map(({ message }) => message);
};

const forbiddenImports = [
  [
    'Conversation internal root barrel',
    'src/features/Conversation/ChatItem/lint-fixture.tsx',
    `import { ChatInput } from '@/features/Conversation';\nvoid ChatInput;`,
    'Conversation internals must use stable subpaths',
  ],
  [
    'NavPanel route Sidebar ownership',
    'src/features/NavPanel/lint-fixture.tsx',
    `import Sidebar from '@/routes/(main)/agent/_layout/Sidebar';\nvoid Sidebar;`,
    'NavPanel must not own route Sidebar implementations',
  ],
  [
    'NavPanel route SideBar ownership',
    'src/features/NavPanel/lint-fixture.tsx',
    `import SideBar from '@/routes/(main)/settings/_layout/SideBar';\nvoid SideBar;`,
    'NavPanel must not own route Sidebar implementations',
  ],
  [
    'route Sidebar NavPanel host barrel',
    'src/routes/(main)/agent/_layout/Sidebar/lint-fixture.tsx',
    `import NavPanel from '@/features/NavPanel';\nvoid NavPanel;`,
    'Route Sidebars must import NavPanelPortal from its dedicated subpath',
  ],
  [
    'HomeInbox RunReplyEditor static import',
    'src/features/HomeInbox/lint-fixture.tsx',
    `import RunReplyEditor from '@/features/AgentTasks/AgentTaskDetail/RunReplyEditor';\nvoid RunReplyEditor;`,
    'Load RunReplyEditor with import()',
  ],
  [
    'HomeInbox TopicChatDrawer static import',
    'src/features/HomeInbox/lint-fixture.tsx',
    `import TopicChatDrawer from '@/features/AgentTasks/AgentTaskDetail/TopicChatDrawer';\nvoid TopicChatDrawer;`,
    'HomeInbox must not mount TopicChatDrawer',
  ],
  [
    'HomeInbox DocumentModal implementation import',
    'src/features/HomeInbox/lint-fixture.tsx',
    `import DocumentModal from '@/features/DocumentModal';\nvoid DocumentModal;`,
    'imperative DocumentModal loader',
  ],
  [
    'home cold-path ChatInput static import',
    'src/features/Home/lint-fixture.tsx',
    `import { ChatInput } from '@/features/ChatInput';\nvoid ChatInput;`,
    'Home cold-path modules must not statically import ChatInput',
  ],
  [
    'home cold-path ChatInput subpath import',
    'src/features/Home/lint-fixture.tsx',
    `import ChatInputDesktop from '@/features/ChatInput/Desktop';\nvoid ChatInputDesktop;`,
    'Home cold-path modules must not statically import ChatInput',
  ],
  [
    'home cold-path Conversation root barrel',
    'src/features/Home/lint-fixture.tsx',
    `import { ChatInput } from '@/features/Conversation';\nvoid ChatInput;`,
    'Home cold-path modules must use stable Conversation subpaths',
  ],
  [
    'home input direct EditorInput import',
    'src/features/Home/InputArea/index.tsx',
    `import EditorInput from './EditorInput';\nvoid EditorInput;`,
    'load EditorInput through useProgressiveEditor',
  ],
  [
    'ShareModal implementation bypass',
    'src/features/PageEditor/lint-fixture.tsx',
    `import openShareModal from '@/features/ShareModal/Modal';\nvoid openShareModal;`,
    'Import the imperative facade from "@/features/ShareModal"',
  ],
  [
    'existing UI restriction remains active',
    'src/features/HomeInbox/lint-fixture.tsx',
    `import { Button } from '@lobehub/ui';\nvoid Button;`,
    'Import from "@lobehub/ui/base-ui" instead',
  ],
] as const;

const allowedImports = [
  [
    'Conversation stable store subpath',
    'src/features/Conversation/ChatItem/lint-fixture.tsx',
    `import { useConversationStore } from '@/features/Conversation/store';\nvoid useConversationStore;`,
  ],
  [
    'route Sidebar dedicated Portal subpath',
    'src/routes/(main)/agent/_layout/Sidebar/lint-fixture.tsx',
    `import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';\nvoid NavPanelPortal;`,
  ],
  [
    'HomeInbox interaction-triggered editor import',
    'src/features/HomeInbox/lint-fixture.tsx',
    `void import('@/features/AgentTasks/AgentTaskDetail/RunReplyEditor');`,
  ],
  [
    'HomeInbox imperative DocumentModal loader',
    'src/features/HomeInbox/lint-fixture.tsx',
    `import { openDocumentModal } from '@/features/DocumentModal/loader';\nvoid openDocumentModal;`,
  ],
  [
    'home interaction-triggered ChatInput import',
    'src/features/Home/lint-fixture.tsx',
    `void import('@/features/ChatInput');`,
  ],
  [
    'home lightweight ChatInput initial-state utility',
    'src/features/Home/lint-fixture.tsx',
    `import { initialState } from '@/features/ChatInput/store/initialState';\nvoid initialState;`,
  ],
  [
    'home lightweight ChatInput context-selection utility',
    'src/features/Home/lint-fixture.tsx',
    `import { resolveContextSelections } from '@/features/ChatInput/utils/contextSelections';\nvoid resolveContextSelections;`,
  ],
  [
    'isolated home EditorInput entry',
    'src/features/Home/InputArea/EditorInput.tsx',
    `import { ChatInput } from '@/features/ChatInput';\nvoid ChatInput;`,
  ],
  [
    'ShareModal imperative facade',
    'src/features/PageEditor/lint-fixture.tsx',
    `import { openShareModal } from '@/features/ShareModal';\nvoid openShareModal;`,
  ],
] as const;

describe('performance import boundaries', () => {
  it.each(forbiddenImports)('rejects %s', async (_name, filePath, code, message) => {
    await expect(lintRestrictedImports(filePath, code)).resolves.toEqual([
      expect.stringContaining(message),
    ]);
  });

  it.each(allowedImports)('allows %s', async (_name, filePath, code) => {
    await expect(lintRestrictedImports(filePath, code)).resolves.toEqual([]);
  });
});
