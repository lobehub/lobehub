import { SCM_EVENT_TAG } from '@/const/plugin';

import { createRemarkXmlBlockPlugin } from '../remarkPlugins/createRemarkXmlBlockPlugin';

/** Captures `<scmEvent …>…</scmEvent>` blocks; see {@link createRemarkXmlBlockPlugin}. */
export const remarkScmEventBlock = createRemarkXmlBlockPlugin(SCM_EVENT_TAG);
