export interface SkillMountContext {
  agentId: string;
  topicId?: string;
}

export interface SkillMountNode {
  content?: string;
  contentType?: 'text/markdown';
  name: string;
  namespace: 'builtin' | 'installed-all' | 'installed-active' | 'agent' | 'agent-topic';
  path: string;
  readOnly: boolean;
  size?: number;
  type: 'directory' | 'file';
}

export interface ResolvedSkillMountPath {
  filePath?: string;
  namespace: SkillMountNode['namespace'];
  relativePath: string;
  skillName?: string;
}
