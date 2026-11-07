'use client';

import SettingsSectionSkeleton from '../Section';
import { useSkeletonText } from '../useSkeletonText';
import type { SettingsTabSkeleton } from './types';

const RUNTIME_TOOLS = ['lobehub', 'node', 'python', 'npm', 'bun', 'bunx', 'pnpm', 'uv'];
const CLI_AGENTS = ['claude', 'codex', 'gemini', 'qwen', 'kimi', 'aider'];

/**
 * The system-tools page: the shell form, then the tool detector's category
 * groups (16px apart inside one form), 36px below. Tool names are fixed, so
 * the rows show them; only the detection status is a placeholder. Categories
 * below the first viewport are left out.
 */
const Body = () => {
  const text = useSkeletonText('setting');
  const status = { height: 22, width: 96 };

  return (
    <>
      <SettingsSectionSkeleton
        groups={[
          {
            control: { height: 32, width: 160 },
            desc: text('settingSystemTools.shell.desc', 220, 12),
            labels: [text('settingSystemTools.shell.mode.title', 80)],
            rows: 1,
            title: text('settingSystemTools.shell.title', 64, 18),
          },
        ]}
      />
      <SettingsSectionSkeleton
        gap={16}
        groups={[
          {
            control: status,
            desc: text('settingSystemTools.category.runtimeEnvironment.desc', 220, 12),
            labels: RUNTIME_TOOLS,
            rows: RUNTIME_TOOLS.length,
            title: text('settingSystemTools.category.runtimeEnvironment', 96, 18),
          },
          {
            control: status,
            desc: text('settingSystemTools.category.cliAgents.desc', 220, 12),
            labels: CLI_AGENTS,
            rows: CLI_AGENTS.length,
            title: text('settingSystemTools.category.cliAgents', 96, 18),
          },
        ]}
      />
    </>
  );
};

const SystemToolsSkeleton: SettingsTabSkeleton = { Body };

export default SystemToolsSkeleton;
