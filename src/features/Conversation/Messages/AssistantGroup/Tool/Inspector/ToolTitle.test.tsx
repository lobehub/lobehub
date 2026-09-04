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
