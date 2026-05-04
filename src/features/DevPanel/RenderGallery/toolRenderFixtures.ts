'use client';

import { ClaudeCodeIdentifier } from '@lobechat/builtin-tool-claude-code/client';
import { builtinTools } from '@lobechat/builtin-tools';
import type { BuiltinToolManifest, LobeChatPluginApi } from '@lobechat/types';

import type { ToolRenderFixture, ToolRenderFixtureVariant } from './lifecycleMode';

export type { ToolRenderFixture, ToolRenderFixtureVariant } from './lifecycleMode';

export interface ToolRenderMeta {
  api?: LobeChatPluginApi;
  apiName: string;
  description?: string;
  identifier: string;
  toolsetDescription?: string;
  toolsetName: string;
}

export const DEVTOOLS_GROUP_ID = 'devtools-preview-group';

export const DEVTOOLS_GROUP_DETAIL = {
  agents: [
    {
      avatar: '🧭',
      backgroundColor: '#E8F3FF',
      id: 'researcher-agent',
      title: 'Researcher',
    },
    {
      avatar: '🛠',
      backgroundColor: '#FFF3E8',
      id: 'builder-agent',
      title: 'Builder',
    },
  ],
  avatar: '👥',
  backgroundColor: '#EEF2FF',
  description: 'Fixture group used by /devtools to preview grouped task renders.',
  id: DEVTOOLS_GROUP_ID,
  title: 'Devtools Preview Group',
};

const customToolsets: Record<
  string,
  {
    api: Array<Pick<LobeChatPluginApi, 'description' | 'name'>>;
    meta: { description?: string; title: string };
  }
> = {
  [ClaudeCodeIdentifier]: {
    api: [
      { description: 'Spawn and summarize a sub-agent task.', name: 'Agent' },
      { description: 'Run a shell command.', name: 'Bash' },
      { description: 'Patch file contents.', name: 'Edit' },
      { description: 'Find files by glob pattern.', name: 'Glob' },
      { description: 'Search file contents.', name: 'Grep' },
      { description: 'Read file content.', name: 'Read' },
      { description: 'Schedule when to resume work.', name: 'ScheduleWakeup' },
      { description: 'Run a Claude Code skill.', name: 'Skill' },
      { description: 'Read output from a background task.', name: 'TaskOutput' },
      { description: 'Stop a background task.', name: 'TaskStop' },
      { description: 'Track todo progress.', name: 'TodoWrite' },
      { description: 'Look up deferred tools by name or keyword.', name: 'ToolSearch' },
      { description: 'Write a new file.', name: 'Write' },
    ],
    meta: {
      description: 'Anthropic Claude Code render previews.',
      title: 'Claude Code',
    },
  },
  'codex': {
    api: [
      { description: 'Run a shell command in Codex.', name: 'command_execution' },
      { description: 'Preview Codex file change summaries.', name: 'file_change' },
      { description: 'Preview Codex todo list rendering.', name: 'todo_list' },
    ],
    meta: {
      description: 'Codex-specific render previews and shared command cards.',
      title: 'Codex',
    },
  },
  'lobe-page-agent': {
    api: [
      { description: 'Initialize a new document with markdown content.', name: 'initPage' },
      { description: 'Edit the title of the current document.', name: 'editTitle' },
      { description: 'Read the structured XML content of the page.', name: 'getPageContent' },
      { description: 'Insert, modify, or remove document nodes.', name: 'modifyNodes' },
      { description: 'Find-and-replace text across the document.', name: 'replaceText' },
    ],
    meta: {
      description: 'Page Agent inspector previews for document operations.',
      title: 'Page Agent',
    },
  },
  'lobe-user-interaction': {
    api: [
      { description: 'Render an inline question card with form fields.', name: 'askUserQuestion' },
    ],
    meta: {
      description: 'User Interaction intervention previews.',
      title: 'User Interaction',
    },
  },
  'lobe-web-onboarding': {
    api: [
      {
        description: 'Save the agent identity collected during web onboarding.',
        name: 'saveUserQuestion',
      },
    ],
    meta: {
      description: 'Web onboarding intervention previews.',
      title: 'Web Onboarding',
    },
  },
};

const manifestByIdentifier = new Map<string, BuiltinToolManifest>(
  builtinTools.map((tool) => [tool.identifier, tool.manifest]),
);

const humanize = (value: string) =>
  value
    .replaceAll('_', ' ')
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase());

const buildStringSample = (key: string, schema: any) => {
  if (schema?.format === 'uri' || key.toLowerCase().includes('url')) return 'https://example.com';
  if (key.toLowerCase().includes('path'))
    return `/workspace/${key.replace(/Path$/i, '').toLowerCase() || 'file'}.ts`;
  if (key.toLowerCase().includes('id')) return `${key}-sample`;
  if (key.toLowerCase().includes('query')) return 'tool render preview';
  if (key.toLowerCase().includes('title')) return 'Preview title';
  if (key.toLowerCase().includes('description')) return 'Preview description';
  if (key.toLowerCase().includes('content') || key.toLowerCase().includes('prompt')) {
    return `Sample ${humanize(key).toLowerCase()} for the devtools preview.`;
  }

  return `${humanize(key)} sample`;
};

const buildSchemaSample = (schema: any, key = 'value'): any => {
  if (!schema) return undefined;
  if (schema.default !== undefined) return schema.default;
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0];
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  switch (schema.type) {
    case 'array': {
      const item = buildSchemaSample(
        schema.items,
        key.endsWith('s') ? key.slice(0, -1) : `${key}Item`,
      );
      return item === undefined ? [] : [item];
    }
    case 'boolean': {
      return true;
    }
    case 'integer':
    case 'number': {
      return 1;
    }
    case 'object': {
      const properties = schema.properties || {};
      return Object.fromEntries(
        Object.entries(properties)
          .map(([propertyKey, propertySchema]) => [
            propertyKey,
            buildSchemaSample(propertySchema, propertyKey),
          ])
          .filter(([, value]) => value !== undefined),
      );
    }
    case 'string':
    default: {
      return buildStringSample(key, schema);
    }
  }
};

const keyOf = (identifier: string, apiName: string) => `${identifier}:${apiName}`;

/**
 * Wrap a single fixture body into the canonical `{ variants: [...] }` shape so
 * APIs that only need one preview state stay terse.
 */
const single = (
  variant: Omit<ToolRenderFixtureVariant, 'id' | 'label'> & {
    id?: string;
    label?: string;
  } = {},
): ToolRenderFixture => ({
  variants: [{ id: 'default', label: 'Default', ...variant }],
});

/**
 * Author multiple lifecycle-state variants (e.g. success / empty / failure) for
 * an API. Each entry only needs `label`; `id` defaults to a slugified label.
 */

const variants = (
  list: Array<Omit<ToolRenderFixtureVariant, 'id'> & { id?: string }>,
): ToolRenderFixture => ({
  variants: list.map((variant, index) => ({
    id: variant.id ?? (variant.label.toLowerCase().replaceAll(/\s+/g, '-') || `variant-${index}`),
    ...variant,
  })),
});

const toolRenderFixtures: Record<string, ToolRenderFixture> = {
  [keyOf('codex', 'command_execution')]: single({
    args: { command: 'bun run type-check' },
    content: 'Checked 1247 files in 2.3s\nNo type errors found.',
    pluginState: {
      exitCode: 0,
      isBackground: false,
      output: 'Checked 1247 files in 2.3s\nNo type errors found.',
      stdout: 'Checked 1247 files in 2.3s\nNo type errors found.',
      success: true,
    },
  }),
  [keyOf('codex', 'file_change')]: single({
    args: {
      changes: [
        {
          kind: 'add',
          linesAdded: 62,
          linesDeleted: 0,
          path: 'src/routes/(main)/devtools/index.tsx',
        },
        {
          kind: 'modify',
          linesAdded: 23,
          linesDeleted: 0,
          path: 'packages/builtin-tools/src/renders.ts',
        },
        {
          kind: 'rename',
          linesAdded: 28,
          linesDeleted: 0,
          path: 'tmp/devtools-preview-old.tsx',
        },
      ],
    },
    content: 'File changes applied (1 added, 1 modified, 1 renamed).',
    pluginState: {
      changes: [
        {
          kind: 'add',
          linesAdded: 62,
          linesDeleted: 0,
          path: 'src/routes/(main)/devtools/index.tsx',
        },
        {
          kind: 'modify',
          linesAdded: 23,
          linesDeleted: 0,
          path: 'packages/builtin-tools/src/renders.ts',
        },
        {
          kind: 'rename',
          linesAdded: 28,
          linesDeleted: 0,
          path: 'tmp/devtools-preview-old.tsx',
        },
      ],
      linesAdded: 113,
      linesDeleted: 0,
    },
  }),
  [keyOf('codex', 'todo_list')]: single({
    args: {
      items: [
        { completed: true, text: 'Wire up the render registry export' },
        { completed: false, text: 'Build a devtools preview page' },
        { completed: false, text: 'Verify every tool render fixture' },
      ],
    },
    content: 'Todo list updated (1/3 completed).',
  }),

  [keyOf(ClaudeCodeIdentifier, 'Agent')]: single({
    args: {
      prompt:
        'Inspect the generated preview fixtures and reply with a short note about the riskiest missing case.',
    },
    content:
      '- Search-driven renders still need richer empty-state fixtures.\n- The grouped execute-tasks preview depends on seeded agent-group state.',
  }),
  [keyOf(ClaudeCodeIdentifier, 'Bash')]: variants([
    {
      args: { command: 'rg -n "TodoListRender" packages src' },
      content:
        'packages/builtin-tools/src/codex/TodoListRender.tsx:11:const TodoListRender = memo<...>',
      label: 'Match found',
      pluginState: {
        exitCode: 0,
        isBackground: false,
        output:
          'packages/builtin-tools/src/codex/TodoListRender.tsx:11:const TodoListRender = memo<...>',
        stdout:
          'packages/builtin-tools/src/codex/TodoListRender.tsx:11:const TodoListRender = memo<...>',
        success: true,
      },
    },
    {
      args: { command: 'bun run type-check' },
      content:
        'src/features/DevPanel/RenderGallery/ToolPreview.tsx(48,12): error TS2304: Cannot find name "Foo".\n',
      label: 'Non-zero exit',
      pluginState: {
        exitCode: 2,
        isBackground: false,
        output:
          'src/features/DevPanel/RenderGallery/ToolPreview.tsx(48,12): error TS2304: Cannot find name "Foo".\n',
        stderr:
          'src/features/DevPanel/RenderGallery/ToolPreview.tsx(48,12): error TS2304: Cannot find name "Foo".\n',
        success: false,
      },
    },
    {
      args: { command: 'find . -name "*.tsx" -not -path "*/node_modules/*" | head -20' },
      content: Array.from({ length: 20 }, (_, i) => `./src/components/Card${i}.tsx`).join('\n'),
      label: 'Large output',
      pluginState: {
        exitCode: 0,
        isBackground: false,
        output: Array.from({ length: 20 }, (_, i) => `./src/components/Card${i}.tsx`).join('\n'),
        stdout: Array.from({ length: 20 }, (_, i) => `./src/components/Card${i}.tsx`).join('\n'),
        success: true,
      },
    },
  ]),
  [keyOf(ClaudeCodeIdentifier, 'Edit')]: single({
    args: {
      file_path: 'src/spa/router/desktopRouter.config.desktop.tsx',
      new_string: "path: 'tasks',",
      old_string: "path: 'tasks',",
    },
  }),
  [keyOf(ClaudeCodeIdentifier, 'Glob')]: single({
    args: { path: 'src/routes', pattern: '**/index.tsx' },
    content: 'src/routes/(main)/agent/index.tsx\nsrc/routes/(main)/devtools/index.tsx',
  }),
  [keyOf(ClaudeCodeIdentifier, 'Grep')]: variants([
    {
      args: { path: 'packages', pattern: 'BuiltinRenderProps', type: 'ts' },
      content:
        'packages/types/src/tool/builtin.ts:244:export interface BuiltinRenderProps<Arguments = any, State = any, Content = any> {\npackages/builtin-tools/src/renders.ts:18:type Render = (p: BuiltinRenderProps) => ReactNode;',
      label: 'Many matches',
    },
    {
      args: { path: 'src', pattern: 'NEVER_MATCH_THIS_TOKEN', type: 'tsx' },
      content: '',
      label: 'No matches',
    },
  ]),
  [keyOf(ClaudeCodeIdentifier, 'Read')]: single({
    args: { file_path: 'packages/builtin-tools/src/renders.ts' },
    content:
      "1  import { RunCommandRender } from '@lobechat/shared-tool-ui/renders';\n2  export interface BuiltinRenderRegistryEntry { ... }",
  }),
  [keyOf(ClaudeCodeIdentifier, 'ScheduleWakeup')]: single({
    args: {
      delaySeconds: 1200,
      reason: 'Recheck the failing build once dependencies finish installing.',
    },
  }),
  [keyOf(ClaudeCodeIdentifier, 'Skill')]: single({
    args: { skill: 'codebase-search' },
    content: 'Use ripgrep first, then open only the relevant files to keep context sharp.',
  }),
  [keyOf(ClaudeCodeIdentifier, 'TaskOutput')]: single({
    args: { block: false, task_id: 'task-build-2025-04-25', timeout_ms: 8000 },
    content:
      '✅  Vite: compile and bundle finished (200) http://localhost:9876/\nDebug Proxy: https://app.lobehub.com/_dangerous_local_dev_proxy?debug-host=http://localhost:9876',
  }),
  [keyOf(ClaudeCodeIdentifier, 'TaskStop')]: single({
    args: { task_id: 'task-build-2025-04-25' },
    content: 'Background task stopped (exit code 0).',
  }),
  [keyOf(ClaudeCodeIdentifier, 'TodoWrite')]: variants([
    {
      args: {
        todos: [
          {
            activeForm: 'Capture current registry coverage',
            content: 'Capture current registry coverage',
            status: 'completed',
          },
          {
            activeForm: 'Build /devtools page',
            content: 'Build /devtools page',
            status: 'in_progress',
          },
          {
            activeForm: 'Audit missing fixtures',
            content: 'Audit missing fixtures',
            status: 'pending',
          },
        ],
      },
      label: 'Mixed progress',
    },
    {
      args: {
        todos: [
          {
            activeForm: 'Plan render gallery rewrite',
            content: 'Plan render gallery rewrite',
            status: 'pending',
          },
          {
            activeForm: 'Sketch lifecycle modes',
            content: 'Sketch lifecycle modes',
            status: 'pending',
          },
        ],
      },
      label: 'All pending',
    },
    {
      args: {
        todos: [
          {
            activeForm: 'Migrate fixtures to variants',
            content: 'Migrate fixtures to variants',
            status: 'completed',
          },
          {
            activeForm: 'Verify in /devtools',
            content: 'Verify in /devtools',
            status: 'completed',
          },
          {
            activeForm: 'Push to remote',
            content: 'Push to remote',
            status: 'completed',
          },
        ],
      },
      label: 'All done',
    },
  ]),
  [keyOf(ClaudeCodeIdentifier, 'ToolSearch')]: single({
    args: { max_results: 5, query: 'select:Read,Edit,Grep' },
    content: 'Loaded 3 deferred tool schemas: Read, Edit, Grep.',
  }),
  [keyOf(ClaudeCodeIdentifier, 'Write')]: single({
    args: {
      content: "export const previewEnabled = process.env.NODE_ENV === 'development';\n",
      file_path: 'src/routes/(main)/devtools/featureFlag.ts',
    },
  }),

  [keyOf('lobe-activator', 'activateSkill')]: single({
    content:
      'This skill focuses on shipping UI previews fast while keeping the registry easy to extend.',
    pluginState: {
      description: 'A lightweight workflow for building internal preview harnesses.',
      name: 'Preview Builder',
    },
  }),

  [keyOf('lobe-agent-builder', 'getAvailableModels')]: single({
    pluginState: {
      providers: [
        {
          id: 'openai',
          models: [
            { abilities: { functionCall: true, reasoning: true, vision: true }, id: 'gpt-5.4' },
            { abilities: { functionCall: true }, id: 'gpt-5.4-mini' },
          ],
          name: 'OpenAI',
        },
        {
          id: 'anthropic',
          models: [{ abilities: { functionCall: true, vision: true }, id: 'claude-sonnet-4' }],
          name: 'Anthropic',
        },
      ],
    },
  }),
  [keyOf('lobe-agent-builder', 'installPlugin')]: single({
    pluginState: {
      awaitingApproval: false,
      installed: true,
      pluginId: 'lobe-web-browsing',
      pluginName: 'Web Browsing',
      serverStatus: 'active',
    },
  }),
  [keyOf('lobe-agent-builder', 'searchMarketTools')]: single({
    pluginState: {
      query: 'browser',
      tools: [
        {
          author: 'LobeHub',
          description: 'Search and crawl web pages with configurable engines.',
          icon: '🌐',
          identifier: 'lobe-web-browsing',
          installed: true,
          name: 'Web Browsing',
          tags: ['search', 'crawl'],
        },
        {
          author: 'LobeHub',
          description: 'Run code and inspect local files inside a sandbox.',
          icon: '🧪',
          identifier: 'lobe-cloud-sandbox',
          installed: false,
          name: 'Cloud Sandbox',
          tags: ['files', 'code'],
        },
      ],
      totalCount: 2,
    },
  }),
  [keyOf('lobe-agent-builder', 'updateAgentConfig')]: single({
    pluginState: {
      config: {
        newValues: { model: 'gpt-5.4', temperature: 0.4 },
        previousValues: { model: 'gpt-5.4-mini', temperature: 0.7 },
        updatedFields: ['model', 'temperature'],
      },
      meta: {
        newValues: {
          description: 'Pairs on internal developer workflows.',
          title: 'Devtools Copilot',
        },
        previousValues: { description: 'General helper.', title: 'Workspace Helper' },
        updatedFields: ['title', 'description'],
      },
      togglePlugin: {
        enabled: true,
        pluginId: 'lobe-web-browsing',
      },
    },
  }),
  [keyOf('lobe-agent-builder', 'updatePrompt')]: single({
    pluginState: {
      newPrompt:
        'Be concise, keep teammates unblocked, and prefer reusable preview infrastructure over one-off screenshots.',
    },
  }),

  [keyOf('lobe-agent-documents', 'createDocument')]: single({
    args: {
      content:
        '# Devtools Preview Plan\n\n- Enumerate every render.\n- Provide a stable sample fixture.\n- Keep the page development-only.',
      title: 'Devtools Preview Plan',
    },
    pluginState: {
      documentId: 'doc_devtools_preview_plan',
    },
  }),

  [keyOf('lobe-agent-management', 'callAgent')]: single({
    args: {
      instruction:
        'Review the `/devtools` route and list any preview cards that still need richer fixtures.',
    },
  }),
  [keyOf('lobe-agent-management', 'createAgent')]: single({
    args: {
      description: 'Internal helper for preview and QA workflows.',
      model: 'gpt-5.4',
      plugins: ['lobe-web-browsing', 'lobe-local-system'],
      provider: 'openai',
      systemRole: 'You help engineers verify UI changes quickly and carefully.',
      title: 'Preview QA Agent',
    },
  }),
  [keyOf('lobe-agent-management', 'duplicateAgent')]: single({
    pluginState: {
      newAgentId: 'agent_preview_clone',
      sourceAgentId: 'agent_workspace_helper',
      success: true,
    },
  }),
  [keyOf('lobe-agent-management', 'getAgentDetail')]: single({
    pluginState: {
      config: {
        model: 'gpt-5.4',
        plugins: ['lobe-web-browsing', 'lobe-cloud-sandbox'],
        provider: 'openai',
        systemRole: 'Focus on frontend verification and fast local feedback loops.',
      },
      meta: {
        avatar: '🧪',
        backgroundColor: '#EEF6FF',
        description: 'Specialized in preview harnesses and UI regression checks.',
        tags: ['preview', 'qa'],
        title: 'Preview Specialist',
      },
    },
  }),
  [keyOf('lobe-agent-management', 'installPlugin')]: single({
    pluginState: {
      installed: true,
      pluginId: 'lobe-cloud-sandbox',
      pluginName: 'Cloud Sandbox',
    },
  }),
  [keyOf('lobe-agent-management', 'searchAgent')]: single({
    pluginState: {
      agents: [
        {
          avatar: '🧪',
          backgroundColor: '#EEF6FF',
          description: 'Preview route and fixture maintainer.',
          id: 'agent_preview_specialist',
          isMarket: false,
          title: 'Preview Specialist',
        },
        {
          avatar: '📚',
          backgroundColor: '#FFF7E8',
          description: 'Keeps internal docs and issue writeups tidy.',
          id: 'agent_doc_partner',
          isMarket: true,
          title: 'Documentation Partner',
        },
      ],
    },
  }),
  [keyOf('lobe-agent-management', 'updateAgent')]: single({
    args: {
      config: JSON.stringify({
        model: 'gpt-5.4',
        systemRole: 'Prioritize maintainable developer tooling and preview coverage.',
      }),
      meta: JSON.stringify({
        description: 'Expanded to cover internal tooling previews.',
        title: 'Workspace Preview Partner',
      }),
    },
  }),
  [keyOf('lobe-agent-management', 'updatePrompt')]: single({
    args: {
      prompt:
        'When asked for a visual check, prefer building a reusable preview harness before taking a screenshot.',
    },
  }),

  [keyOf('lobe-cloud-sandbox', 'editLocalFile')]: single({
    args: { path: '/sandbox/src/routes/devtools.tsx' },
    pluginState: {
      diffText:
        '--- a/sandbox/src/routes/devtools.tsx\n+++ b/sandbox/src/routes/devtools.tsx\n@@ -1,2 +1,3 @@\n export const devtools = true;\n+export const previews = true;\n',
      linesAdded: 1,
      linesDeleted: 0,
      replacements: 1,
    },
  }),
  [keyOf('lobe-cloud-sandbox', 'executeCode')]: single({
    args: {
      code: 'const tools = ["todo", "file_change", "command_execution"]; console.log(tools.length);',
      language: 'typescript',
    },
    pluginState: {
      output: '3',
      stderr: '',
    },
  }),
  [keyOf('lobe-cloud-sandbox', 'exportFile')]: single({
    args: { path: '/sandbox/reports/devtools-preview.html' },
    pluginState: {
      downloadUrl: 'https://example.com/devtools-preview.html',
      filename: 'devtools-preview.html',
      success: true,
    },
  }),
  [keyOf('lobe-cloud-sandbox', 'listLocalFiles')]: variants([
    {
      args: { directoryPath: '/sandbox/src/routes' },
      label: 'Mixed entries',
      pluginState: {
        files: [
          { isDirectory: true, name: 'agent' },
          { isDirectory: false, name: 'index.tsx', size: 2048 },
          { isDirectory: false, name: 'devtools.tsx', size: 4096 },
        ],
      },
    },
    {
      args: { directoryPath: '/sandbox/empty' },
      label: 'Empty directory',
      pluginState: { files: [] },
    },
    {
      args: { directoryPath: '/sandbox/many' },
      label: 'Many files',
      pluginState: {
        files: Array.from({ length: 24 }, (_, i) => ({
          isDirectory: false,
          name: `report-${i.toString().padStart(2, '0')}.csv`,
          size: 4096 + i * 128,
        })),
      },
    },
  ]),
  [keyOf('lobe-cloud-sandbox', 'moveLocalFiles')]: single({
    pluginState: {
      results: [
        {
          destination: '/sandbox/archive/devtools-preview.tsx',
          source: '/sandbox/tmp/devtools-preview.tsx',
          success: true,
        },
      ],
      successCount: 1,
      totalCount: 1,
    },
  }),
  [keyOf('lobe-cloud-sandbox', 'readLocalFile')]: single({
    args: { path: '/sandbox/src/routes/devtools.tsx' },
    pluginState: {
      content: 'export default function Devtools() {\n  return <div>Preview</div>;\n}\n',
      endLine: 3,
      startLine: 1,
      totalLines: 3,
    },
  }),
  [keyOf('lobe-cloud-sandbox', 'runCommand')]: variants([
    {
      args: { command: 'bunx vitest run src/spa/router/desktopRouter.sync.test.tsx' },
      content: '1 passed',
      label: 'Tests pass',
      pluginState: {
        exitCode: 0,
        isBackground: false,
        output: '1 passed',
        stdout: '1 passed',
        success: true,
      },
    },
    {
      args: { command: 'bunx vitest run src/spa/router/desktopRouter.sync.test.tsx' },
      content:
        'FAIL  src/spa/router/desktopRouter.sync.test.tsx > desktop router config sync\n  expected route /devtools but received undefined.\n',
      label: 'Test failure',
      pluginState: {
        exitCode: 1,
        isBackground: false,
        output:
          'FAIL  src/spa/router/desktopRouter.sync.test.tsx > desktop router config sync\n  expected route /devtools but received undefined.\n',
        stderr:
          'FAIL  src/spa/router/desktopRouter.sync.test.tsx > desktop router config sync\n  expected route /devtools but received undefined.\n',
        success: false,
      },
    },
  ]),
  [keyOf('lobe-cloud-sandbox', 'searchLocalFiles')]: variants([
    {
      args: { directory: '/sandbox/src', keyword: 'devtools' },
      label: 'Two matches',
      pluginState: {
        results: [
          { isDirectory: false, name: 'devtools.tsx', path: '/sandbox/src/routes/devtools.tsx' },
          {
            isDirectory: false,
            name: 'desktopRouter.config.tsx',
            path: '/sandbox/src/spa/router/desktopRouter.config.tsx',
          },
        ],
        totalCount: 2,
      },
    },
    {
      args: { directory: '/sandbox/src', keyword: 'no-such-keyword' },
      label: 'No results',
      pluginState: {
        results: [],
        totalCount: 0,
      },
    },
  ]),
  [keyOf('lobe-cloud-sandbox', 'writeLocalFile')]: single({
    args: {
      content: 'export const isDevtoolsEnabled = true;\n',
      path: '/sandbox/src/routes/devtools/flags.ts',
    },
  }),

  [keyOf('lobe-group-agent-builder', 'batchCreateAgents')]: single({
    args: {
      agents: [
        {
          avatar: '🧪',
          description: 'Checks render output and local screenshots.',
          title: 'Preview QA',
          tools: ['lobe-web-browsing', 'lobe-cloud-sandbox'],
        },
        {
          avatar: '📝',
          description: 'Writes issue notes and rollout summaries.',
          title: 'Docs Writer',
          tools: ['lobe-notebook'],
        },
      ],
    },
    pluginState: {
      agents: [
        { agentId: 'agent_preview_qa', success: true, title: 'Preview QA' },
        { agentId: 'agent_docs_writer', success: true, title: 'Docs Writer' },
      ],
    },
  }),
  [keyOf('lobe-group-agent-builder', 'updateAgentPrompt')]: single({
    pluginState: {
      newPrompt: 'Focus on validating preview fixtures and reporting only concrete UI issues.',
    },
  }),
  [keyOf('lobe-group-agent-builder', 'updateGroupPrompt')]: single({
    pluginState: {
      newPrompt: 'Coordinate fixture coverage across agents and avoid overlapping work.',
    },
  }),

  [keyOf('lobe-group-management', 'broadcast')]: single({
    args: {
      instruction:
        'Everyone review one tool render section and flag any empty states that look broken.',
    },
  }),
  [keyOf('lobe-group-management', 'executeAgentTask')]: single({
    args: {
      instruction: 'Verify the `/devtools` route works in desktop development mode.',
      timeout: 1_800_000,
      title: 'Desktop smoke check',
    },
  }),
  [keyOf('lobe-group-management', 'executeAgentTasks')]: single({
    args: {
      tasks: [
        {
          agentId: 'researcher-agent',
          instruction: 'Check which render entries still fall back to empty-state samples.',
          title: 'Fixture audit',
        },
        {
          agentId: 'builder-agent',
          instruction:
            'Verify router gating and ensure production builds cannot navigate to /devtools.',
          title: 'Route audit',
        },
      ],
    },
  }),
  [keyOf('lobe-group-management', 'speak')]: single({
    args: {
      instruction:
        'Summarize the preview harness approach in two short sentences for the issue update.',
    },
  }),

  [keyOf('lobe-gtd', 'clearTodos')]: single({
    pluginState: {
      todos: {
        items: [
          { status: 'completed', text: 'Capture real stream data' },
          { status: 'processing', text: 'Build /devtools route' },
        ],
      },
    },
  }),
  [keyOf('lobe-gtd', 'createPlan')]: single({
    pluginState: {
      plan: {
        context:
          'We want a reusable development-only page that renders every registered builtin tool card with a stable sample fixture.',
        description: 'Create a maintainable preview harness for builtin tool renders.',
        goal: 'Build /devtools render preview',
        id: 'plan_devtools_preview',
      },
    },
  }),
  [keyOf('lobe-gtd', 'createTodos')]: variants([
    {
      label: 'Mixed',
      pluginState: {
        todos: {
          items: [
            { status: 'completed', text: 'Enumerate all render entries' },
            { status: 'processing', text: 'Create preview fixtures' },
            { status: 'todo', text: 'Smoke test the route locally' },
          ],
        },
      },
    },
    {
      label: 'Many todos',
      pluginState: {
        todos: {
          items: Array.from({ length: 10 }, (_, i) => ({
            status: i < 3 ? 'completed' : i < 5 ? 'processing' : 'todo',
            text: `Subtask ${i + 1}: prepare fixtures for batch ${i + 1}`,
          })),
        },
      },
    },
    {
      label: 'All done',
      pluginState: {
        todos: {
          items: [
            { status: 'completed', text: 'Enumerate render entries' },
            { status: 'completed', text: 'Author preview fixtures' },
            { status: 'completed', text: 'Smoke-test the gallery' },
          ],
        },
      },
    },
  ]),
  [keyOf('lobe-gtd', 'execTask')]: single({
    pluginState: {
      task: {
        description: 'Smoke test the desktop router config',
        instruction:
          'Run the desktop router sync test and confirm /devtools only appears in development.',
      },
    },
  }),
  [keyOf('lobe-gtd', 'execTasks')]: single({
    pluginState: {
      tasks: [
        {
          description: 'Audit builtin render coverage',
          instruction: 'Find any registered render without a usable sample fixture.',
        },
        {
          description: 'Check route gating',
          instruction: 'Make sure production builds do not expose /devtools.',
        },
      ],
    },
  }),
  [keyOf('lobe-gtd', 'updatePlan')]: single({
    pluginState: {
      plan: {
        context:
          'The route is now in place; expand the preview harness by keeping fixture data next to the page.',
        description: 'Track the follow-up work for richer render fixtures.',
        goal: 'Expand /devtools coverage',
        id: 'plan_devtools_preview',
      },
    },
  }),
  [keyOf('lobe-gtd', 'updateTodos')]: single({
    pluginState: {
      todos: {
        items: [
          { status: 'completed', text: 'Export render registry entries' },
          { status: 'processing', text: 'Hydrate grouped task fixtures' },
          { status: 'todo', text: 'Add richer missing-state cases' },
        ],
      },
    },
  }),

  [keyOf('lobe-knowledge-base', 'readKnowledge')]: single({
    pluginState: {
      files: [
        {
          fileId: 'kb_devtools_guide',
          filename: 'devtools-preview-guide.md',
          preview:
            'Use the /devtools route to visually verify builtin tool renders during development.',
          totalCharCount: 1420,
          totalLineCount: 42,
        },
      ],
    },
  }),
  [keyOf('lobe-knowledge-base', 'searchKnowledgeBase')]: single({
    pluginState: {
      fileResults: [
        {
          fileId: 'kb_router_preview',
          fileName: 'router-preview-checklist.md',
          relevanceScore: 0.93,
        },
        {
          fileId: 'kb_tool_fixtures',
          fileName: 'tool-render-fixtures.md',
          relevanceScore: 0.88,
        },
      ],
    },
  }),

  [keyOf('lobe-local-system', 'editLocalFile')]: single({
    args: { path: '/workspace/src/spa/router/desktopRouter.config.tsx' },
    pluginState: {
      diffText:
        "--- a/workspace/src/spa/router/desktopRouter.config.tsx\n+++ b/workspace/src/spa/router/desktopRouter.config.tsx\n@@ -1,3 +1,7 @@\n export const desktopRoutes = [\n+  {\n+    path: 'devtools',\n+  },\n ];\n",
    },
  }),
  [keyOf('lobe-local-system', 'listLocalFiles')]: single({
    pluginState: {
      files: [
        { isDirectory: true, name: 'src' },
        { isDirectory: false, name: 'package.json', size: 1320 },
        { isDirectory: false, name: 'README.md', size: 4096 },
      ],
    },
  }),
  [keyOf('lobe-local-system', 'moveLocalFiles')]: single({
    args: {
      items: [
        {
          newPath: '/workspace/src/routes/(main)/devtools/index.tsx',
          oldPath: '/workspace/tmp/devtools-preview.tsx',
        },
      ],
    },
  }),
  [keyOf('lobe-local-system', 'readLocalFile')]: single({
    args: { path: '/workspace/src/routes/(main)/devtools/index.tsx' },
    pluginState: {
      content: 'export default function DevtoolsPage() {\n  return <div>Render preview</div>;\n}\n',
      endLine: 3,
      fullPath: '/workspace/src/routes/(main)/devtools/index.tsx',
      path: 'src/routes/(main)/devtools/index.tsx',
      startLine: 1,
      totalLines: 3,
    },
  }),
  [keyOf('lobe-local-system', 'runCommand')]: single({
    args: { command: 'bun run type-check' },
    content: 'Checked 1247 files in 2.3s\nNo type errors found.',
    pluginState: {
      exitCode: 0,
      isBackground: false,
      output: 'Checked 1247 files in 2.3s\nNo type errors found.',
      stdout: 'Checked 1247 files in 2.3s\nNo type errors found.',
      success: true,
    },
  }),
  [keyOf('lobe-local-system', 'searchLocalFiles')]: variants([
    {
      args: { keywords: 'quarterly report sample' },
      label: 'Multiple matches',
      pluginState: {
        results: [
          {
            isDirectory: false,
            name: 'sample-quarterly-report-q1.xlsx',
            path: '/Users/sample-user/Downloads/sample-quarterly-report-q1.xlsx',
            size: 9_400,
          },
          {
            isDirectory: false,
            name: 'sample_quarterly_report_q2_draft.xlsx',
            path: '/Users/sample-user/Downloads/sample_quarterly_report_q2_draft.xlsx',
            size: 35_600,
          },
          {
            isDirectory: false,
            name: 'sample-quarterly-report-q3.xlsx',
            path: '/Users/sample-user/Documents/reports/sample-quarterly-report-q3.xlsx',
            size: 8_300,
          },
          {
            isDirectory: false,
            name: 'sample-quarterly-report-archived.xlsx',
            path: '/Users/sample-user/Documents/archive/2024/sample-quarterly-report-archived.xlsx',
            size: 16_200,
          },
        ],
        totalCount: 4,
      },
    },
    {
      args: { keywords: 'no-such-keyword-on-disk' },
      label: 'No results',
      pluginState: {
        results: [],
        totalCount: 0,
      },
    },
  ]),
  [keyOf('lobe-local-system', 'writeLocalFile')]: single({
    args: {
      content: 'export const devtoolsEnabled = process.env.NODE_ENV === "development";\n',
      path: '/workspace/src/routes/(main)/devtools/flags.ts',
    },
  }),

  [keyOf('lobe-user-memory', 'addExperienceMemory')]: single({
    args: {
      details: 'A reusable preview harness saved time compared with manual screenshot stitching.',
      summary: 'Building /devtools made visual QA faster and repeatable.',
      tags: ['devtools', 'preview', 'qa'],
      title: 'Preview harness rollout',
      withExperience: {
        action: 'Built a development-only route backed by stable sample fixtures.',
        keyLearning: 'Reusable preview pages reduce repeated manual validation work.',
        possibleOutcome: 'Future render additions can be checked in one place.',
        reasoning: 'A route-based harness is easier to maintain than ad hoc screenshot scripts.',
        situation: 'We needed to verify many builtin tool cards quickly.',
      },
    },
  }),
  [keyOf('lobe-user-memory', 'addPreferenceMemory')]: single({
    args: {
      details: 'Prefer route-based previews for UI verification over isolated screenshots.',
      summary: 'Use reusable local preview routes for internal QA.',
      tags: ['workflow', 'frontend'],
      title: 'Preview workflow preference',
      withPreference: {
        appContext: {
          app: 'LobeHub Desktop',
          feature: 'Builtin tool rendering',
          surface: '/devtools',
        },
        conclusionDirectives:
          'Keep fixtures close to the route and update them when new renders land.',
        originContext: {
          actor: 'Frontend engineer',
          applicableWhen: 'Adding or refactoring tool renders',
          scenario: 'Need to verify many cards at once',
          trigger: 'A screenshot or local QA request comes in',
        },
        suggestions: ['Add a preview fixture before shipping a new render.'],
        type: 'workflow',
      },
    },
  }),
  [keyOf('lobe-user-memory', 'searchUserMemory')]: variants([
    {
      label: 'Has results',
      pluginState: {
        activities: [
          {
            feedback: 'The page made local validation much easier.',
            id: 'activity_devtools',
            narrative: 'Implemented a dev-only /devtools route for builtin render previews.',
            notes: 'Devtools preview route',
            tags: ['preview', 'devtools'],
            type: 'engineering',
          },
        ],
        experiences: [
          {
            action: 'Adopted a route-based preview harness.',
            id: 'experience_devtools',
            keyLearning: 'Stable fixtures are cheaper than repeating manual screenshots.',
            situation: 'Needed to verify many render components in one place.',
            tags: ['render', 'qa'],
          },
        ],
        preferences: [
          {
            conclusionDirectives: 'Prefer reusable preview infrastructure for repeated UI checks.',
            id: 'preference_devtools',
            tags: ['workflow'],
            title: 'Preview harness preference',
          },
        ],
      },
    },
    {
      label: 'No results',
      pluginState: {
        activities: [],
        experiences: [],
        preferences: [],
      },
    },
  ]),

  [keyOf('lobe-notebook', 'createDocument')]: single({
    pluginState: {
      document: {
        content:
          '# Devtools route\n\nThis page renders every registered builtin tool card with sample fixtures so local QA stays fast.',
        id: 'notebook_devtools_route',
        title: 'Devtools Route Notes',
      },
    },
  }),

  [keyOf('lobe-skill-store', 'importFromMarket')]: single({
    content: 'preview-builder',
    pluginState: {
      name: 'preview-builder',
      status: 'created',
      success: true,
    },
  }),
  [keyOf('lobe-skill-store', 'importSkill')]: single({
    content: 'preview-builder',
    pluginState: {
      name: 'preview-builder',
      status: 'updated',
      success: true,
    },
  }),
  [keyOf('lobe-skill-store', 'searchSkill')]: single({
    pluginState: {
      items: [
        {
          category: 'Engineering',
          description: 'Scaffold and maintain internal preview routes for UI checks.',
          identifier: 'preview-builder',
          installCount: 128,
          name: 'Preview Builder',
          repository: 'https://github.com/lobehub/preview-builder',
          summary: 'Reusable preview harness workflows.',
          version: '0.3.1',
        },
      ],
    },
  }),

  [keyOf('lobe-skills', 'activateSkill')]: single({
    content: 'Use a fixture-backed route to preview all builtin tool cards locally.',
    pluginState: {
      description: 'Reusable workflow for internal preview harnesses.',
      name: 'Preview Builder',
    },
  }),
  [keyOf('lobe-skills', 'execScript')]: single({
    args: { command: 'pnpm lint src/routes/(main)/devtools' },
    content: 'No lint issues found.',
    pluginState: {
      command: 'pnpm lint src/routes/(main)/devtools',
    },
  }),
  [keyOf('lobe-skills', 'readReference')]: single({
    content:
      'export const listBuiltinRenderEntries = () => [{ identifier: "codex", apiName: "todo_list" }];\n',
    pluginState: {
      encoding: 'utf-8',
      fullPath: '/workspace/packages/builtin-tools/src/renders.ts',
      path: 'packages/builtin-tools/src/renders.ts',
      size: 2048,
    },
  }),
  [keyOf('lobe-skills', 'runCommand')]: single({
    args: { command: 'bunx vitest run src/spa/router/desktopRouter.sync.test.tsx' },
    content: '1 passed',
    pluginState: {
      exitCode: 0,
      isBackground: false,
      output: '1 passed',
      stdout: '1 passed',
      success: true,
    },
  }),

  [keyOf('lobe-web-browsing', 'crawlMultiPages')]: single({
    args: {
      urls: ['https://lobehub.com', 'https://docs.lobehub.com'],
    },
    pluginState: {
      results: [
        {
          crawler: 'firecrawl',
          data: {
            content: 'LobeHub ships desktop and web experiences for AI collaboration.',
            description: 'Product homepage',
            title: 'LobeHub',
            url: 'https://lobehub.com',
          },
          originalUrl: 'https://lobehub.com',
        },
        {
          crawler: 'firecrawl',
          data: {
            content: 'Developer documentation for routing, tooling, and local testing.',
            description: 'Docs homepage',
            title: 'LobeHub Docs',
            url: 'https://docs.lobehub.com',
          },
          originalUrl: 'https://docs.lobehub.com',
        },
      ],
    },
  }),
  [keyOf('lobe-web-browsing', 'crawlSinglePage')]: single({
    args: { url: 'https://lobehub.com/blog' },
    pluginState: {
      results: [
        {
          crawler: 'firecrawl',
          data: {
            content: 'Recent product updates and engineering notes.',
            description: 'Blog landing page',
            title: 'LobeHub Blog',
            url: 'https://lobehub.com/blog',
          },
          originalUrl: 'https://lobehub.com/blog',
        },
      ],
    },
  }),
  [keyOf('lobe-web-browsing', 'search')]: variants([
    {
      args: {
        query: 'LobeHub devtools preview route',
        searchEngines: ['google', 'bing'],
      },
      label: 'With results',
      pluginState: {
        query: 'LobeHub devtools preview route',
        results: [
          {
            content: 'Documentation and implementation notes about local preview tooling.',
            engines: ['google'],
            title: 'Preview tooling guide',
            url: 'https://docs.example.com/preview-tooling',
          },
          {
            content: 'Issue thread describing the /devtools route rollout.',
            engines: ['bing'],
            title: 'Builtin render devtools issue',
            url: 'https://linear.example.com/issue/LOBE-8114',
          },
        ],
      },
    },
    {
      args: {
        query: 'undocumented internal preview snapshot harness',
        searchEngines: ['google'],
      },
      label: 'No results',
      pluginState: {
        query: 'undocumented internal preview snapshot harness',
        results: [],
      },
    },
  ]),

  [keyOf('lobe-page-agent', 'initPage')]: single({
    args: {
      markdown:
        '# Devtools Render Gallery\n\nA development-only preview surface for every builtin tool render.\n\n- Inspector previews mirror the chat title bar.\n- Body segments switch between Render, Streaming, Placeholder, and Intervention.\n',
    },
    pluginState: { nodeCount: 6 },
  }),
  [keyOf('lobe-page-agent', 'editTitle')]: single({
    args: { title: 'Devtools Render Gallery — Builtin Tool Previews' },
    pluginState: { previousTitle: 'Devtools Render Gallery' },
  }),
  [keyOf('lobe-page-agent', 'getPageContent')]: single({
    args: {},
    pluginState: { nodeCount: 12 },
    content:
      '<doc><heading id="h-1">Devtools Render Gallery</heading><para id="p-1">Preview every registered builtin tool component.</para></doc>',
  }),
  [keyOf('lobe-page-agent', 'modifyNodes')]: single({
    args: {
      operations: [
        { afterId: 'h-1', kind: 'insertAfter', xml: '<para>Updated description.</para>' },
        {
          id: 'p-2',
          kind: 'modify',
          xml: '<para id="p-2">Now mentions Segmented body tabs.</para>',
        },
        { id: 'p-3', kind: 'remove' },
      ],
    },
    pluginState: { applied: 3 },
  }),
  [keyOf('lobe-page-agent', 'replaceText')]: single({
    args: {
      isRegex: false,
      newText: 'Body segments',
      replaceAll: true,
      searchText: 'Body section',
    },
    pluginState: { replacements: 2 },
  }),

  [keyOf('lobe-user-interaction', 'askUserQuestion')]: single({
    args: {
      question: {
        description:
          'Help us tailor the next reply. Pick the rendering surface you want previewed.',
        fields: [
          {
            key: 'surface',
            kind: 'select',
            label: 'Preview surface',
            options: [
              { label: 'Render', value: 'render' },
              { label: 'Streaming', value: 'streaming' },
              { label: 'Placeholder', value: 'placeholder' },
              { label: 'Intervention', value: 'intervention' },
            ],
            placeholder: 'Choose one',
            required: true,
          },
          {
            key: 'note',
            kind: 'textarea',
            label: 'Optional note',
            placeholder: 'Anything to call out about the preview?',
          },
        ],
        id: 'devtools-preview-question',
        mode: 'form',
        prompt: 'Which builtin tool surface should we focus the next preview iteration on?',
      },
    },
  }),

  [keyOf('lobe-web-onboarding', 'saveUserQuestion')]: single({
    args: {
      agentEmoji: '🧪',
      agentName: 'Devtools Tester',
      fullName: 'Arvin',
      interests: ['observability', 'dev-tools', 'agent-runtime'],
      responseLanguage: 'en-US',
    },
  }),

  [keyOf('github', 'run_command')]: single({
    args: {
      command: 'gh api /repos/lobehub/lobe-chat/issues?state=open',
    },
    pluginState: {
      command: 'gh api /repos/lobehub/lobe-chat/issues?state=open',
      exitCode: 0,
      success: true,
    },
  }),
};

export const getToolRenderFixture = (
  identifier: string,
  apiName: string,
  api?: LobeChatPluginApi,
): ToolRenderFixture => {
  const fixture = toolRenderFixtures[keyOf(identifier, apiName)];
  if (fixture) return fixture;

  return single({
    args: buildSchemaSample(api?.parameters, apiName) || {},
  });
};

export const getToolRenderMeta = (identifier: string, apiName: string): ToolRenderMeta => {
  const manifest = manifestByIdentifier.get(identifier);
  const api = manifest?.api.find((item) => item.name === apiName);
  const customToolset = customToolsets[identifier];
  const customApi = customToolset?.api.find((item) => item.name === apiName);

  return {
    api,
    apiName,
    description: api?.description || customApi?.description,
    identifier,
    toolsetDescription: manifest?.meta.description || customToolset?.meta.description,
    toolsetName: manifest?.meta.title || customToolset?.meta.title || humanize(identifier),
  };
};
