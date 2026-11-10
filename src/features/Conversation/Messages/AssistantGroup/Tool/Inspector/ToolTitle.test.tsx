import { LocalSystemApiName, LocalSystemIdentifier } from '@lobechat/builtin-tool-local-system';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ToolTitle from './ToolTitle';

// ToolTitle reads the plugin namespace through react-i18next; resolve the
// runCommand label to a fixed echo so assertions can match on it verbatim.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key.startsWith('builtins.') ? (key.split('.').at(-1) ?? key) : key),
  }),
}));

describe('ToolTitle', () => {
  describe('lh goal steps from a CLI agent', () => {
    const createArgs = {
      command: 'lh goal create "Fog report" --conversation --criterion "Four lines" --json',
      description: 'Create LobeHub goal bound to conversation',
    };

    it('reads a running goal create as the goal being created, with its title', () => {
      render(<ToolTitle isLoading apiName={'Bash'} args={createArgs} identifier={'claude-code'} />);

      expect(screen.getByText('loading')).toBeInTheDocument();
      expect(screen.getByText('Fog report')).toBeInTheDocument();
      // Neither the generic action label nor the model's English description.
      expect(screen.queryByText('Bash')).toBeNull();
      expect(screen.queryByText(createArgs.description)).toBeNull();
    });

    it('flips to the settled label once the step finishes', () => {
      render(<ToolTitle apiName={'Bash'} args={createArgs} identifier={'claude-code'} />);

      expect(screen.getByText('completed')).toBeInTheDocument();
      expect(screen.getByText('Fog report')).toBeInTheDocument();
    });

    it('says the step failed when the goal command errored', () => {
      // The collapsed row used to read "completed" beside a failed status icon.
      render(
        <ToolTitle
          apiName={'Bash'}
          args={createArgs}
          identifier={'claude-code'}
          result={{ state: { exitCode: 1, success: false } }}
        />,
      );

      expect(screen.getByText('failed')).toBeInTheDocument();
      expect(screen.queryByText('completed')).toBeNull();
    });

    it('also treats a result error as failed', () => {
      render(
        <ToolTitle
          apiName={'Bash'}
          args={createArgs}
          identifier={'claude-code'}
          result={{ error: { message: 'unknown option' } }}
        />,
      );

      expect(screen.getByText('failed')).toBeInTheDocument();
    });

    it('reads a plan submission without a raw goal id', () => {
      render(
        <ToolTitle
          isLoading
          apiName={'command_execution'}
          args={{ command: 'lh goal plan goal_1 --token t --file plan.json --json' }}
          identifier={'codex'}
        />,
      );

      expect(screen.getByText('loading')).toBeInTheDocument();
      expect(screen.queryByText(/goal_1/)).toBeNull();
    });
  });

  it.each([
    { title: '沙盒交付链路问题' },
    { description: '修复沙盒权限问题', title: '沙盒交付链路问题' },
    { query: '沙盒权限' },
    { path: '/docs/沙盒说明.md' },
  ])('keeps the action label for CJK resource arguments: %j', (args) => {
    render(<ToolTitle apiName={'create_issue'} args={args} identifier={'linear'} />);

    expect(screen.getByText('create_issue')).toBeInTheDocument();
  });

  describe('model-written description rendering', () => {
    it('renders a CJK description standalone — no action label, no code font', () => {
      render(
        <ToolTitle
          apiName={LocalSystemApiName.runCommand}
          args={{ command: 'docker ps', description: '查看当前运行中的 Docker 容器' }}
          identifier={LocalSystemIdentifier}
        />,
      );

      expect(screen.getByText('查看当前运行中的 Docker 容器')).toBeInTheDocument();
      // The action label must be dropped next to a standalone description.
      expect(screen.queryByText('runCommand')).toBeNull();
    });

    it('keeps the "<label> <keyword>" shape for a latin command keyword', () => {
      render(
        <ToolTitle
          apiName={LocalSystemApiName.runCommand}
          args={{ command: 'docker ps' }}
          identifier={LocalSystemIdentifier}
        />,
      );

      expect(screen.getByText('runCommand')).toBeInTheDocument();
      expect(screen.getByText('docker')).toBeInTheDocument();
    });

    it('keeps the label for a latin model description (reads as a spec, not a step)', () => {
      render(
        <ToolTitle
          apiName={LocalSystemApiName.runCommand}
          args={{ command: 'ls -la', description: 'docker-compose.yaml' }}
          identifier={LocalSystemIdentifier}
        />,
      );

      expect(screen.getByText('runCommand')).toBeInTheDocument();
      expect(screen.getByText('docker-compose.yaml')).toBeInTheDocument();
    });
  });
});
