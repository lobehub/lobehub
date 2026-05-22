import { isDesktop } from '@lobechat/const';
import { type ListProjectSkillsResult, type ProjectSkillItem } from '@lobechat/electron-client-ipc';
import type { IEditor, SlashOptions } from '@lobehub/editor';
import { SkillsIcon } from '@lobehub/ui/icons';
import Fuse from 'fuse.js';
import { $getSelection, $isRangeSelection } from 'lexical';
import { ArchiveIcon, MessageSquarePlusIcon } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { localFileService } from '@/services/electron/localFileService';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useChatInputStore } from '../../store';
import { INSERT_ACTION_TAG_COMMAND, type InsertActionTagPayload } from './command';
import { type ActionTagData, BUILTIN_COMMANDS } from './types';
import { useInstalledSkillsAndTools } from './useInstalledSkillsAndTools';

type SlashItem = NonNullable<SlashOptions['items'] extends (infer U)[] ? U : never>;

interface SlashMenuOption {
  icon?: any;
  key: string;
  label: string;
  metadata?: Record<string, any>;
  onSelect?: (editor: IEditor, matchingString: string) => void;
}

const COMMAND_ICONS: Record<string, any> = {
  compact: ArchiveIcon,
  newTopic: MessageSquarePlusIcon,
};

export const useSlashActionItems = (): SlashOptions['items'] => {
  const { t } = useTranslation('editor');
  const editorInstance = useChatInputStore((s) => s.editor);
  const activeTopicId = useChatStore((s) => s.activeTopicId);

  // Resolve hetero-agent working directory so we can surface its project skills.
  // Topic-level override takes precedence over the agent's configured cwd.
  const agentId = useAgentId();
  const isHetero = useAgentStore((s) =>
    agentId ? !!agentByIdSelectors.getAgencyConfigById(agentId)(s)?.heterogeneousProvider : false,
  );
  const agentWorkingDirectory = useAgentStore((s) =>
    agentId ? agentByIdSelectors.getAgentWorkingDirectoryById(agentId)(s) : undefined,
  );
  const topicWorkingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);
  const workingDirectory = topicWorkingDirectory || agentWorkingDirectory;

  const skillsEnabled = isDesktop && isHetero && !!workingDirectory;
  const { data: projectSkillsData } = useClientDataSWR<ListProjectSkillsResult>(
    skillsEnabled ? ['project-skills', workingDirectory] : null,
    () => localFileService.listProjectSkills({ scope: workingDirectory! }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const projectSkills = projectSkillsData?.skills;

  // Installed skills shared with the @ mention menu (builtin / lobehub / market / user agent skills).
  // Tools intentionally stay out of slash — they remain @-mention only.
  const installedSkillsAndTools = useInstalledSkillsAndTools();
  const installedSkills = useMemo(
    () => installedSkillsAndTools.filter((item) => item.category === 'skill'),
    [installedSkillsAndTools],
  );

  return useCallback(
    async (
      search: { leadOffset: number; matchingString: string; replaceableString: string } | null,
    ) => {
      const allItems: SlashItem[] = [];

      const makeCommandItem = (action: ActionTagData): SlashMenuOption => ({
        icon: COMMAND_ICONS[action.type],
        key: `action-${action.type}`,
        label: t(`slash.${action.type}` as any),
        metadata: { category: action.category, type: action.type },
        onSelect: (editor: IEditor) => {
          const payload: InsertActionTagPayload = {
            category: action.category,
            label: t(`slash.${action.type}` as any) as string,
            type: action.type,
          };
          editor.dispatchCommand(INSERT_ACTION_TAG_COMMAND, payload);
        },
      });

      const makeProjectSkillItem = (skill: ProjectSkillItem): SlashMenuOption => ({
        // Slash is already implied by the trigger + tag color, so we render the
        // bare skill name here. The markdown writer adds the `/` back on send.
        icon: SkillsIcon,
        key: `project-skill-${skill.name}`,
        label: skill.name,
        metadata: {
          category: 'projectSkill',
          description: skill.description,
          type: skill.name,
        },
        onSelect: (editor: IEditor) => {
          const payload: InsertActionTagPayload = {
            category: 'projectSkill',
            label: skill.name,
            type: skill.name,
          };
          editor.dispatchCommand(INSERT_ACTION_TAG_COMMAND, payload);
        },
      });

      const makeSkillItem = (skill: ActionTagData): SlashMenuOption => ({
        icon: SkillsIcon,
        key: `skill-${skill.type}`,
        label: skill.label,
        metadata: { category: 'skill', type: skill.type },
        onSelect: (editor: IEditor) => {
          const payload: InsertActionTagPayload = {
            category: 'skill',
            label: skill.label,
            type: skill.type,
          };
          editor.dispatchCommand(INSERT_ACTION_TAG_COMMAND, payload);
        },
      });

      // Trigger position:
      //   - line-start  → commands + installed skills + project skills
      //   - mid-line w/ preceding whitespace → installed skills + project skills only (no commands)
      //   - otherwise (e.g. inside http://, a/b) → menu suppressed
      let isAtLineStart = search === null;
      let isMidLineAfterWhitespace = false;
      if (!isAtLineStart && editorInstance) {
        const lexicalEditor = editorInstance.getLexicalEditor();
        if (lexicalEditor) {
          lexicalEditor.getEditorState().read(() => {
            const selection = $getSelection();
            if (!$isRangeSelection(selection)) return;
            const node = selection.anchor.getNode();
            const topElement = node.getTopLevelElement();
            if (!topElement) return;

            const paragraphText = topElement.getTextContent();
            const triggerAndSearch = '/' + (search?.matchingString || '');

            if (paragraphText === triggerAndSearch) {
              isAtLineStart = true;
              return;
            }

            const triggerIndex = paragraphText.lastIndexOf(triggerAndSearch);
            if (triggerIndex === 0) {
              isAtLineStart = true;
            } else if (triggerIndex > 0 && /\s/.test(paragraphText[triggerIndex - 1])) {
              isMidLineAfterWhitespace = true;
            }
          });
        }
      }

      if (!isAtLineStart && !isMidLineAfterWhitespace) return [];

      // Built-in commands — line-start only
      if (isAtLineStart) {
        for (const action of BUILTIN_COMMANDS) {
          if (action.type === 'newTopic' && !activeTopicId) continue;
          allItems.push(makeCommandItem(action) as SlashItem);
        }
      }

      // Installed skills — shown in both positions
      for (const skill of installedSkills) {
        allItems.push(makeSkillItem(skill) as SlashItem);
      }

      // Hetero-agent project skills (file-system based, resolved by the CLI agent itself)
      if (projectSkills && projectSkills.length > 0) {
        for (const skill of projectSkills) {
          allItems.push(makeProjectSkillItem(skill) as SlashItem);
        }
      }

      // Fuzzy filtering
      if (search?.matchingString && search.matchingString.length > 0) {
        const fuse = new Fuse(allItems, { keys: ['key', 'label'], threshold: 0.4 });
        return fuse.search(search.matchingString).map((r) => r.item);
      }

      return allItems;
    },
    [t, editorInstance, activeTopicId, projectSkills, installedSkills],
  );
};
