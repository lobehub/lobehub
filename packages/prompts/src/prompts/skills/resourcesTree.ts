import type { SkillResourceMeta } from '@lobechat/types';

interface TreeNode {
  children: Map<string, TreeNode>;
  name: string;
  size?: number;
}

const formatSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const buildTree = (resources: Record<string, SkillResourceMeta>): TreeNode => {
  const root: TreeNode = { children: new Map(), name: '' };

  for (const [path, meta] of Object.entries(resources)) {
    const parts = path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;

      if (!current.children.has(part)) {
        current.children.set(part, {
          children: new Map(),
          name: part,
          size: isFile ? meta.size : undefined,
        });
      }

      current = current.children.get(part)!;
    }
  }

  return root;
};

const renderTree = (node: TreeNode, prefix: string = ''): string[] => {
  const lines: string[] = [];
  const entries = [...node.children.entries()].sort(([a], [b]) => {
    // Directories first, then files
    const aIsDir = node.children.get(a)!.children.size > 0;
    const bIsDir = node.children.get(b)!.children.size > 0;
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
    return a.localeCompare(b);
  });

  for (let i = 0; i < entries.length; i++) {
    const [, child] = entries[i];
    const isLast = i === entries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const isDir = child.children.size > 0;

    if (isDir) {
      lines.push(`${prefix}${connector}${child.name}/`);
      const childPrefix = prefix + (isLast ? '    ' : '│   ');
      lines.push(...renderTree(child, childPrefix));
    } else {
      const sizeText = child.size !== undefined ? ` (${formatSize(child.size)})` : '';
      lines.push(`${prefix}${connector}${child.name}${sizeText}`);
    }
  }

  return lines;
};

export const buildResourcesTreeText = (resources: Record<string, SkillResourceMeta>): string => {
  const tree = buildTree(resources);
  const lines = renderTree(tree);
  return lines.join('\n');
};

export const resourcesTreePrompt = (
  skillName: string,
  resources: Record<string, SkillResourceMeta>,
): string => {
  const treeText = buildResourcesTreeText(resources);

  return `## Available Resources

Use \`readReference\` with skillName="${skillName}" and the file path to read these files.

\`\`\`
${treeText}
\`\`\``;
};
