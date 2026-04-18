'use client';

import { memo } from 'react';

import { type ActionKeys } from '@/features/ChatInput';
import { ChatInput } from '@/features/Conversation';
import { useChatStore } from '@/store/chat';

import WorkingDirectoryBar from './WorkingDirectoryBar';

// Heterogeneous agents (e.g. Claude Code) bring their own toolchain, memory,
// and model, so LobeHub-side pickers don't apply. Typo is kept so the user
// can still toggle the rich-text formatting bar.
const leftActions: ActionKeys[] = ['typo'];
const rightActions: ActionKeys[] = [];

/**
 * HeterogeneousChatInput
 *
 * Simplified ChatInput for heterogeneous agents (Claude Code, etc.).
 * Keeps only: text input, typo toggle, send button, and a working-directory
 * picker — no model/tools/memory/KB/MCP/runtime-mode/upload.
 */
const HeterogeneousChatInput = memo(() => {
  return (
    <ChatInput
      skipScrollMarginWithList
      leftActions={leftActions}
      rightActions={rightActions}
      runtimeConfigSlot={<WorkingDirectoryBar />}
      sendButtonProps={{ shape: 'round' }}
      onEditorReady={(instance) => {
        // Sync to global ChatStore for compatibility with other features
        useChatStore.setState({ mainInputEditor: instance });
      }}
    />
  );
});

HeterogeneousChatInput.displayName = 'HeterogeneousChatInput';

export default HeterogeneousChatInput;
