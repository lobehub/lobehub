/**
 * LobeHub review toolbar — annotate a delivered product in place.
 *
 * Script tag (auto-starts):
 *   <script src="https://…/review-sdk/assets/v1/lobehub-review.js"
 *           data-server="https://app.lobehub.com"
 *           data-acceptance="<acceptance id>"></script>
 *
 * Or from code, to add product facts (e.g. which data scenario is loaded):
 *   const toolbar = LobeHubReview.init({ server, acceptanceId, context: () => ({ scenario, seed }) });
 *
 * Remarks are posted as the reviewer's own LobeHub user, onto that acceptance,
 * after they approve this site in a LobeHub popup.
 */
import { ReviewToolbar, type ReviewToolbarOptions } from './toolbar';

export type { ReviewToolbarOptions } from './toolbar';

let instance: ReviewToolbar | null = null;

export function init(options: ReviewToolbarOptions): ReviewToolbar {
  if (typeof document === 'undefined') throw new Error('LobeHubReview runs in a browser page');
  instance?.destroy();
  instance = new ReviewToolbar(options);
  return instance;
}

export function destroy() {
  instance?.destroy();
  instance = null;
}

// Script-tag setup: read the configuration off the tag that loaded us.
if (typeof document !== 'undefined') {
  const script = document.currentScript as HTMLScriptElement | null;
  const server = script?.dataset.server;
  const acceptanceId = script?.dataset.acceptance;
  if (server && acceptanceId) {
    const start = () =>
      init({
        acceptanceId,
        commit: script?.dataset.commit,
        launcher: script?.dataset.launcher !== 'false',
        locale: script?.dataset.locale,
        server,
      });
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  }
}
