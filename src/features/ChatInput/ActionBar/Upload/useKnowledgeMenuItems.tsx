import { type ItemType } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { ArrowRight, LibraryBig } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import RepoIcon from '@/components/LibIcon';
import { openAttachKnowledgeModal } from '@/features/LibraryModal';
import { useAgentStore } from '@/store/agent';
import { agentProjectionSelectors, useAgentValue } from '@/store/agent/projection';

import { useAgentId } from '../../hooks/useAgentId';
import { useChatInputResourceAccess } from '../../hooks/useChatInputResourceAccess';
import CheckboxItem from '../components/CheckboxWithLoading';

// Keep every row's leading icon the same width. The menu's icon slot sizes to its
// content, so a larger file-type icon next to a smaller line icon would widen that
// slot and push its label out of alignment with the upload / "view more" rows.
export const MENU_ICON_SIZE = 20;

/**
 * Builds the knowledge half of the paperclip menu: the related files/libraries
 * group plus the entry into the full picker.
 *
 * Returns nothing for members who cannot configure the resource. `fileUpload`
 * stays in CHAT_ONLY_ACTIONS so chat-only members keep the paperclip, but
 * attaching knowledge mutates the agent config and the picker's own
 * `getKnowledgeBasesAndFiles` query asserts edit access server-side — offering
 * it here would open a modal that immediately fails. Same gate the Plus menu
 * applies to its Attachments submenu.
 */
export const useKnowledgeMenuItems = ({
  onUpdatingChange,
}: {
  onUpdatingChange: (updating: boolean) => void;
}): ItemType[] => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const { canConfigureResource } = useChatInputResourceAccess();

  const files = useAgentValue(agentId, agentProjectionSelectors.files, isEqual);
  const knowledgeBases = useAgentValue(agentId, agentProjectionSelectors.knowledgeBases, isEqual);

  const [toggleFile, toggleKnowledgeBase] = useAgentStore((s) => [
    s.toggleFile,
    s.toggleKnowledgeBase,
  ]);

  if (!canConfigureResource) return [];

  const items: ItemType[] = [];

  if (files.length > 0 || knowledgeBases.length > 0) {
    items.push({
      children: [
        // first the files
        ...files.map((item) => ({
          icon: <FileIcon fileName={item.name} fileType={item.type} size={MENU_ICON_SIZE} />,
          key: item.id,
          label: (
            <CheckboxItem
              checked={item.enabled}
              id={item.id}
              label={item.name}
              onUpdate={async (id, enabled) => {
                onUpdatingChange(true);
                await toggleFile(id, enabled);
                onUpdatingChange(false);
              }}
            />
          ),
        })),

        // then the knowledge bases
        ...knowledgeBases.map((item) => ({
          icon: <RepoIcon size={MENU_ICON_SIZE} />,
          key: item.id,
          label: (
            <CheckboxItem
              checked={item.enabled}
              id={item.id}
              label={item.name}
              onUpdate={async (id, enabled) => {
                onUpdatingChange(true);
                await toggleKnowledgeBase(id, enabled);
                onUpdatingChange(false);
              }}
            />
          ),
        })),
      ],
      key: 'relativeFilesOrLibraries',
      label: t('knowledgeBase.relativeFilesOrLibraries'),
      type: 'group',
    });
  }

  const hasRelated = items.length > 0;

  if (hasRelated) {
    items.push({ type: 'divider' });
  } else {
    items.push({
      disabled: true,
      key: 'knowledge-empty',
      label: t('knowledgeBase.related.empty'),
    });
  }

  // The picker entry is the only way to attach the first library or file, so it has to
  // stay reachable while nothing is attached yet — otherwise the empty hint is a dead end.
  items.push({
    extra: <Icon icon={ArrowRight} />,
    icon: <Icon icon={LibraryBig} size={MENU_ICON_SIZE} />,
    key: 'knowledge-base-store',
    label: hasRelated ? t('knowledgeBase.viewMore') : t('knowledgeBase.related.browse'),
    onClick: () => {
      openAttachKnowledgeModal();
    },
  });

  return items;
};
