import { isMacOS } from './platform';

export const isCommandPressed = (event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey'>) => {
  // metaKey on macOS = Command; ctrlKey elsewhere
  return isMacOS() ? event.metaKey : event.ctrlKey;
};
