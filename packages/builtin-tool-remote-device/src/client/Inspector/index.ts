import { RemoteDeviceApiName } from '../../types';
import { ActivateDeviceInspector } from './ActivateDevice';
import { ListOnlineDevicesInspector } from './ListOnlineDevices';

export const RemoteDeviceInspectors = {
  [RemoteDeviceApiName.activateDevice]: ActivateDeviceInspector,
  [RemoteDeviceApiName.listOnlineDevices]: ListOnlineDevicesInspector,
};
