/**
 * What an undescribed shell command does, as the action half of its collapsed
 * title. Each value is the suffix of a `builtins.shellCommand.<action>` key in
 * the `plugin` namespace.
 */
export type ShellCommandAction =
  // Exploration
  | 'read'
  | 'search'
  | 'findFiles'
  | 'list'
  | 'listFiles'
  | 'useSkill'
  // Tests, Git and inline scripts
  | 'runTests'
  | 'commit'
  | 'commitAndPush'
  | 'push'
  | 'write'
  | 'runScript.bun'
  | 'runScript.node'
  | 'runScript.perl'
  | 'runScript.python'
  | 'runScript.ruby'
  | 'runScript.shell'
  // GitHub CLI
  | 'pr.check'
  | 'pr.close'
  | 'pr.comment'
  | 'pr.create'
  | 'pr.edit'
  | 'pr.list'
  | 'pr.merge'
  | 'issue.close'
  | 'issue.comment'
  | 'issue.create'
  | 'issue.edit'
  | 'issue.list'
  | 'issue.reopen'
  | 'issue.view'
  | 'ci.cancel'
  | 'ci.list'
  | 'ci.logs'
  | 'ci.rerun'
  | 'ci.view'
  | 'ci.workflowRun'
  | 'githubApi'
  // Vercel CLI
  | 'vercel.deploy'
  | 'vercel.envList'
  | 'vercel.envPull'
  | 'vercel.inspect'
  | 'vercel.list'
  | 'vercel.logs'
  | 'vercel.promote'
  | 'vercel.redeploy'
  // LobeHub CLI
  | 'acceptance.feedback'
  | 'acceptance.ingest'
  | 'acceptance.linkPr'
  | 'acceptance.list'
  | 'acceptance.preflight'
  | 'acceptance.publish'
  | 'acceptance.view';

/**
 * The collapsed title of a shell command no description explains:
 * "读取 app.ts", "搜索 TODO in src", "运行测试 a.test.ts".
 */
export interface ShellCommandTitle {
  action: ShellCommandAction;
  /**
   * Prose (a commit message, an issue title) rather than a path, command or
   * identifier, so it renders in the body font instead of the code font.
   */
  isProse?: boolean;
  subject?: string;
}
