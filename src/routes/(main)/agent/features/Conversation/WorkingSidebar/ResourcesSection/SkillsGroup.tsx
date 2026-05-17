import { isDesktop } from '@lobechat/const';
import { type ListProjectSkillsResult, type ProjectSkillItem } from '@lobechat/electron-client-ipc';
import { Center, Empty, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { Spin } from 'antd';
import { createStaticStyles } from 'antd-style';
import { ChevronRightIcon, FileIcon, FolderIcon } from 'lucide-react';
import path from 'pathe';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { localFileService } from '@/services/electron/localFileService';
import { useChatStore } from '@/store/chat';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chevron: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
    transition: transform ${cssVar.motionDurationFast} ${cssVar.motionEaseInOut};
  `,
  chevronExpanded: css`
    transform: rotate(90deg);
  `,
  childItem: css`
    cursor: pointer;

    height: 26px;
    padding-inline-end: 8px;
    border-radius: 6px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  childItemIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  treeChevronSlot: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 14px;
    height: 14px;
  `,
  description: css`
    max-width: 320px;
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
  `,
  groupCount: css`
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
  groupLabel: css`
    font-size: 12px;
    font-weight: 500;
  `,
  item: css`
    cursor: pointer;

    height: 28px;
    padding-inline: 4px 8px;
    border-radius: 6px;

    font-size: 13px;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  itemCount: css`
    flex-shrink: 0;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
  itemIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface TreeNode {
  children: TreeNode[];
  isDirectory: boolean;
  name: string;
  path: string;
}

const buildSkillTree = (paths: string[]): TreeNode[] => {
  const root: TreeNode = { children: [], isDirectory: true, name: '', path: '' };

  for (const fullPath of paths) {
    const parts = fullPath.split('/').filter(Boolean);
    let current = root;
    let accumPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      accumPath = accumPath ? `${accumPath}/${part}` : part;
      const isDirectory = i < parts.length - 1;

      let child = current.children.find((c) => c.name === part);
      if (!child) {
        child = { children: [], isDirectory, name: part, path: accumPath };
        current.children.push(child);
      }
      current = child;
    }
  }

  const sortNode = (node: TreeNode) => {
    node.children.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const child of node.children) sortNode(child);
  };
  sortNode(root);

  return root.children;
};

const TREE_BASE_INSET = 24;
const TREE_DEPTH_INDENT = 14;

interface TreeRowProps {
  depth: number;
  expanded: Set<string>;
  node: TreeNode;
  onOpenFile: (relativePath: string) => void;
  onToggleFolder: (folderPath: string) => void;
}

const TreeRow = memo<TreeRowProps>(({ depth, expanded, node, onOpenFile, onToggleFolder }) => {
  const isOpen = expanded.has(node.path);
  const paddingInlineStart = TREE_BASE_INSET + depth * TREE_DEPTH_INDENT;

  if (node.isDirectory) {
    return (
      <>
        <Flexbox
          horizontal
          align={'center'}
          className={styles.childItem}
          gap={6}
          style={{ paddingInlineStart }}
          onClick={() => onToggleFolder(node.path)}
        >
          <span className={styles.treeChevronSlot}>
            <Icon
              className={`${styles.chevron} ${isOpen ? styles.chevronExpanded : ''}`}
              icon={ChevronRightIcon}
              size={12}
            />
          </span>
          <Icon className={styles.childItemIcon} icon={FolderIcon} size={12} />
          <Text ellipsis style={{ flex: 1, fontSize: 12, minWidth: 0 }}>
            {node.name}
          </Text>
        </Flexbox>
        {isOpen &&
          node.children.map((child) => (
            <TreeRow
              depth={depth + 1}
              expanded={expanded}
              key={child.path}
              node={child}
              onOpenFile={onOpenFile}
              onToggleFolder={onToggleFolder}
            />
          ))}
      </>
    );
  }

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={styles.childItem}
      gap={6}
      style={{ paddingInlineStart }}
      title={node.path}
      onClick={() => onOpenFile(node.path)}
    >
      <span className={styles.treeChevronSlot} />
      <Icon className={styles.childItemIcon} icon={FileIcon} size={12} />
      <Text ellipsis style={{ flex: 1, fontSize: 12, minWidth: 0 }}>
        {node.name}
      </Text>
    </Flexbox>
  );
});

TreeRow.displayName = 'SkillTreeRow';

interface SkillRowProps {
  expanded: boolean;
  onOpenFile: (relativePath: string) => void;
  onToggle: () => void;
  skill: ProjectSkillItem;
  workingDirectory: string;
}

const SkillRow = memo<SkillRowProps>(
  ({ expanded, onOpenFile, onToggle, skill, workingDirectory }) => {
    const openLocalFile = useChatStore((s) => s.openLocalFile);
    const handleOpenSkill = () => openLocalFile({ filePath: skill.path, workingDirectory });
    const tree = useMemo(() => buildSkillTree(skill.files), [skill.files]);
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());

    const toggleFolder = useCallback((folderPath: string) => {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        if (next.has(folderPath)) next.delete(folderPath);
        else next.add(folderPath);
        return next;
      });
    }, []);

    return (
      <>
        <Tooltip
          placement={'left'}
          title={
            skill.description ? (
              <span className={styles.description}>{skill.description}</span>
            ) : undefined
          }
        >
          <Flexbox horizontal align={'center'} className={styles.item} gap={6}>
            <Flexbox
              align={'center'}
              justify={'center'}
              style={{ cursor: 'pointer', flexShrink: 0, height: 20, width: 20 }}
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
            >
              <Icon
                className={`${styles.chevron} ${expanded ? styles.chevronExpanded : ''}`}
                icon={ChevronRightIcon}
                size={14}
              />
            </Flexbox>
            <Icon className={styles.itemIcon} icon={SkillsIcon} size={14} />
            <Text ellipsis style={{ flex: 1, minWidth: 0 }} onClick={handleOpenSkill}>
              {skill.name}
            </Text>
            <span className={styles.itemCount}>{skill.fileCount}</span>
          </Flexbox>
        </Tooltip>
        {expanded &&
          tree.map((node) => (
            <TreeRow
              depth={0}
              expanded={expandedFolders}
              key={node.path}
              node={node}
              onOpenFile={onOpenFile}
              onToggleFolder={toggleFolder}
            />
          ))}
      </>
    );
  },
);

SkillRow.displayName = 'SkillRow';

interface SkillsGroupProps {
  workingDirectory: string;
}

const SkillsGroup = memo<SkillsGroupProps>(({ workingDirectory }) => {
  const { t } = useTranslation('chat');
  const openLocalFile = useChatStore((s) => s.openLocalFile);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggle = useCallback((skillDir: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(skillDir)) {
        next.delete(skillDir);
      } else {
        next.add(skillDir);
      }
      return next;
    });
  }, []);

  const enabled = isDesktop && !!workingDirectory;
  const { data, error, isLoading } = useClientDataSWR<ListProjectSkillsResult>(
    enabled ? ['project-skills', workingDirectory] : null,
    () => localFileService.listProjectSkills({ scope: workingDirectory }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  if (!enabled) return null;

  const totalCount = data?.skills.length ?? 0;
  // listProjectSkills approves `data.root` for preview. Hand that exact value
  // back to openLocalFile so LocalFileProtocolManager.createPreviewUrl's
  // approved-root check matches; fall back to the requested workingDirectory
  // while the SWR fetch is in flight.
  const previewWorkspaceRoot = data?.root || workingDirectory;

  return (
    <Flexbox gap={4}>
      <Flexbox horizontal align={'center'} gap={6} paddingInline={4}>
        <Text className={styles.groupLabel} type={'secondary'}>
          {t('workingPanel.skills.title')}
        </Text>
        {totalCount > 0 && <span className={styles.groupCount}>{totalCount}</span>}
      </Flexbox>
      {isLoading ? (
        <Center paddingBlock={12}>
          <Spin size={'small'} />
        </Center>
      ) : error || !data || data.skills.length === 0 ? (
        <Center gap={8} paddingBlock={16}>
          <Empty description={t('workingPanel.skills.empty')} icon={SkillsIcon} />
        </Center>
      ) : (
        <Flexbox gap={2}>
          {data.skills.map((skill) => (
            <SkillRow
              expanded={expanded.has(skill.skillDir)}
              key={skill.skillDir}
              skill={skill}
              workingDirectory={previewWorkspaceRoot}
              onToggle={() => toggle(skill.skillDir)}
              onOpenFile={(relativePath) =>
                openLocalFile({
                  filePath: path.join(skill.skillDir, relativePath),
                  workingDirectory: previewWorkspaceRoot,
                })
              }
            />
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

SkillsGroup.displayName = 'SkillsGroup';

export default SkillsGroup;
