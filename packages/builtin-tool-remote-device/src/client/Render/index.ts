import { RemoteDeviceApiName } from '../../types';
import ActivateDevice from './ActivateDevice';
import ListDevices from './ListDevices';

export const RemoteDeviceRenders = {
  [RemoteDeviceApiName.activateDevice]: ActivateDevice,
  [RemoteDeviceApiName.listOnlineDevices]: ListDevices,
};
