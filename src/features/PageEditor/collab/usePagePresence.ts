import { IYjsService } from '@lobehub/editor';
import { $getNodeByKey } from 'lexical';
import { useCallback, useEffect, useState } from 'react';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { usePageEditorStore } from '../store';
import { type PresencePeer, samePresencePeers, toPresencePeers } from './presence';
import { getSectionTitle } from './presenceSection';

const FLASH_DURATION_MS = 1600;

export const usePagePresence = () => {
  const editor = usePageEditorStore((s) => s.editor);
  const collabStatus = usePageEditorStore((s) => s.collab?.status);
  const userId = useUserStore(userProfileSelectors.userId);
  const [peers, setPeers] = useState<PresencePeer[]>([]);

  useEffect(() => {
    const service = collabStatus ? editor?.requireService(IYjsService) : undefined;
    if (!service) {
      setPeers([]);
      return;
    }
    return service.subscribeAwarenessUsers((users) => {
      const clientId = service.getState()?.doc?.clientID ?? -1;
      const next = toPresencePeers(users, { clientId, userId });
      setPeers((prev) => (samePresencePeers(prev, next) ? prev : next));
    });
  }, [editor, collabStatus, userId]);

  const getCursor = useCallback(
    (clientId: number) =>
      editor?.requireService(IYjsService)?.getState()?.binding.cursors.get(clientId)?.selection,
    [editor],
  );

  const hasCursor = useCallback((clientId: number) => !!getCursor(clientId), [getCursor]);

  const getSection = useCallback(
    (clientId: number) => {
      const lexicalEditor = editor?.getLexicalEditor();
      const anchorKey = getCursor(clientId)?.anchor.key;
      if (!lexicalEditor || !anchorKey) return undefined;
      return getSectionTitle(lexicalEditor, anchorKey);
    },
    [editor, getCursor],
  );

  const jumpTo = useCallback(
    (peer: PresencePeer) => {
      const lexicalEditor = editor?.getLexicalEditor();
      const cursor = getCursor(peer.clientId);
      if (!lexicalEditor || !cursor) return false;

      cursor.caret.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const blockKey = lexicalEditor
        .getEditorState()
        .read(() => $getNodeByKey(cursor.anchor.key)?.getTopLevelElement()?.getKey());
      const block = blockKey ? lexicalEditor.getElementByKey(blockKey) : null;
      block?.animate(
        [
          { backgroundColor: `color-mix(in srgb, ${peer.color} 16%, transparent)` },
          { backgroundColor: 'transparent' },
        ],
        { duration: FLASH_DURATION_MS, easing: 'ease-out' },
      );
      return true;
    },
    [editor, getCursor],
  );

  return { getSection, hasCursor, jumpTo, peers };
};
