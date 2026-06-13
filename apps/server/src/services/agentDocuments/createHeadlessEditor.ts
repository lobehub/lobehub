import { createHeadlessEditor } from '@lobehub/editor/headless';

import { AgentDocumentMediaPlugin } from './headlessMediaPlugin';

export const createAgentDocumentHeadlessEditor = () =>
  createHeadlessEditor({
    additionalPlugins: [AgentDocumentMediaPlugin],
  });
