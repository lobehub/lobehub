import { createModal } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import Content from './Content';

/**
 * Import local CLI agent sessions (Claude Code / Codex) into the given agent.
 * Desktop-only: discovery runs over IPC in the Electron main process.
 */
export const openHeteroSessionImportModal = (options: { agentId: string }) => {
  createModal({
    content: <Content agentId={options.agentId} />,
    footer: null,
    maskClosable: false,
    styles: { content: { padding: 0 } },
    title: t('heteroImport.title', { ns: 'topic' }),
    width: 'min(92vw, 1080px)',
  });
};
