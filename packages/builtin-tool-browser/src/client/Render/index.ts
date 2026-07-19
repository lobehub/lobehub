import { BrowserApiName } from '../../types';
import PageAction from './PageAction';
import Screenshot from './Screenshot';
import Snapshot from './Snapshot';

/**
 * Browser Tool Render Components Registry — keyed by api name.
 */
export const BrowserRenders = {
  [BrowserApiName.click]: PageAction,
  [BrowserApiName.fill]: PageAction,
  [BrowserApiName.navigate]: PageAction,
  [BrowserApiName.press]: PageAction,
  [BrowserApiName.readPage]: Snapshot,
  [BrowserApiName.screenshot]: Screenshot,
  [BrowserApiName.scroll]: PageAction,
  [BrowserApiName.snapshot]: Snapshot,
};
