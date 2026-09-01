import { BrowserApiName } from '../../types';
import PageAction from './PageAction';
import { PageDump } from './PageDump';
import Screenshot from './Screenshot';

/**
 * Browser Tool Render Components Registry — keyed by api name.
 */
export const BrowserRenders = {
  [BrowserApiName.click]: PageAction,
  [BrowserApiName.fill]: PageAction,
  [BrowserApiName.navigate]: PageAction,
  [BrowserApiName.press]: PageAction,
  [BrowserApiName.readPage]: PageDump,
  [BrowserApiName.screenshot]: Screenshot,
  [BrowserApiName.scroll]: PageAction,
  [BrowserApiName.snapshot]: PageDump,
};

export { PageAction, PageDump, Screenshot };
