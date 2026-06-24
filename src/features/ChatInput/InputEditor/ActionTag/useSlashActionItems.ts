import { isDesktop } from '@lobechat/const';
import { type ProjectSkillItem } from '@lobechat/electron-client-ipc';
import type { IEditor, SlashOptions } from '@lobehub/editor';
import { SkillsIcon } from '@lobehub/ui/icons';
import isEqual from 'fast-deep-equal';
import Fuse from 'fuse.js';
import { $getSelection, $isRangeSelection } from 'lexical';
import { ArchiveIcon, MessageSquarePlusIcon } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { useFetchProjectSkills } from '@/hooks/useFetchProjectSkills';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useToolStore } from '@/store/tool';
import { agentDocumentSkillsSelectors } from '@/store/tool/selectors';
import type { AgentDocumentSkillItem } from '@/store/tool/slices/agentDocumentSkills/initialState';

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

  // Resolve the active working directory so we can surface filesystem project
  // skills. Topic-level override takes precedence over the agent's configured
  // cwd. Both homogeneous and heterogeneous runtimes accept project skills now
  // (see commit dd4a4e7595), so we no longer gate on the hetero provider.
  const agentId = useAgentId();
  // Unified cwd: topic > agent's per-device choice > device default > home.
  // This is what makes project skills load even when only a device default is
  // set (and for local-device runs), not just an explicit agent/topic pick.
  const workingDirectory = useEffectiveWorkingDirectory(agentId);

  // Device-bound (remote) runs scan project skills on that device over the
  // `device.listProjectSkills` RPC; the local desktop reads over Electron IPC.
  // Mirror the WorkingSidebar exactly: resolve the EFFECTIVE target first, then
  // treat it as remote only when it lands on `device` with a bound device. The
  // effective target matters because an agent saved as desktop "This device"
  // (`local` + boundDeviceId) coerces to `device` when opened on web —
  // reading the raw stored target would miss that and leave the menu empty even
  // though the sidebar lists the skills.
  const agencyConfig = useAgentStore((s) =>
    agentId ? agentByIdSelectors.getAgencyConfigById(agentId)(s) : undefined,
  );
  const isHetero = useAgentStore((s) =>
    agentId ? agentByIdSelectors.isAgentHeterogeneousById(agentId)(s) : false,
  );
  const effectiveTarget = resolveExecutionTarget(agencyConfig, {
    isHetero,
    clientExecutionAvailable: isDesktop,
  });
  const isDeviceMode = effectiveTarget === 'device' && !!agencyConfig?.boundDeviceId;
  const remoteDeviceId = isDeviceMode ? agencyConfig.boundDeviceId : undefined;

  // Local desktop reads over IPC; a bound device reads over RPC. Either path
  // makes project skills reachable even when this client isn't the desktop app
  // (previously gated on `isDesktop` alone, so remote/web runs got nothing).
  const projectSkillsEnabled = (isDesktop || !!remoteDeviceId) && !!workingDirectory;
  const { data: projectSkillsData } = useFetchProjectSkills(
    projectSkillsEnabled ? workingDirectory : undefined,
    remoteDeviceId,
  );
  const projectSkills = projectSkillsData?.skills;

  // Agent-document skill bundles (the "Agent skills" group in the working
  // sidebar). Share the SWR key with the sidebar fetch so we don't double-fetch.
  useToolStore((s) => s.useFetchAgentDocumentSkills)(agentId);
  const agentDocumentSkills = useToolStore(
    agentDocumentSkillsSelectors.getAgentDocumentSkills,
    isEqual,
  );

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

      const makeAgentSkillItem = (skill: AgentDocumentSkillItem): SlashMenuOption => {
        const label = skill.title || skill.name;
        return {
          icon: SkillsIcon,
          // Identifier already carries the `agent-skills:` prefix, which keeps it
          // unique against project / builtin skills.
          key: `agent-skill-${skill.identifier}`,
          label,
          metadata: {
            category: 'agentSkill',
            description: skill.description,
            type: skill.identifier,
          },
          onSelect: (editor: IEditor) => {
            const payload: InsertActionTagPayload = {
              category: 'agentSkill',
              label,
              type: skill.identifier,
            };
            editor.dispatchCommand(INSERT_ACTION_TAG_COMMAND, payload);
          },
        };
      };

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

      // Agent-document skill bundles (per-agent, resolved server-side via the
      // `agent-skills:<filename>` identifier prefix).
      for (const skill of agentDocumentSkills) {
        allItems.push(makeAgentSkillItem(skill) as SlashItem);
      }

      // Filesystem project skills (`.agents/skills/` / `.claude/skills/` under
      // the working directory). Both homogeneous and heterogeneous runtimes
      // resolve them — the homogeneous runtime treats them as additional
      // `<available_skills>` entries.
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
    [t, editorInstance, activeTopicId, projectSkills, installedSkills, agentDocumentSkills],
  );
};
