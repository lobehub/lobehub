import { isDesktop } from './version';

export const ELECTRON_BE_PROTOCOL_SCHEME = 'lobe-backend';

export const withElectronProtocolIfElectron = (url: string) => {
  return isDesktop ? `${ELECTRON_BE_PROTOCOL_SCHEME}://lobe${url}` : url;
};
