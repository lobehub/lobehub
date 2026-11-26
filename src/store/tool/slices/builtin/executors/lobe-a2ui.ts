import { A2uiExecutor } from '@lobechat/builtin-tool-a2ui/executor';

import { a2uiService } from '@/services/a2ui';

/**
 * The client runs the card tool on the server, so the A2UI catalog schemas, examples and
 * validator stay out of the browser bundle.
 */
export const a2uiExecutor = new A2uiExecutor({
  readCardDocs: a2uiService.readCardDocs,
  renderUI: a2uiService.renderUI,
});
