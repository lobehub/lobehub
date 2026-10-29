import { normalizeAsyncError } from '@/libs/swr/normalizeError';

/** Translate only known, user-actionable domain errors; never expose raw server failures. */
export const getChannelSaveErrorKey = (error: unknown) => {
  const { rawMessage, status } = normalizeAsyncError(error);
  switch (rawMessage) {
    case 'Choose an online device and working directory': {
      return 'environment.executionRequired';
    }
    case 'Choose a working directory for this device': {
      return 'environment.directoryRequired';
    }
    case 'Choose an accessible device shared with this workspace': {
      return 'environment.deviceUnavailable';
    }
    case 'Could not reach the device to verify the working directory': {
      return 'environment.deviceUnreachable';
    }
    case 'The working directory does not exist or is not a directory': {
      return 'environment.directoryInvalid';
    }
    case 'The device connector must be upgraded to verify the working directory': {
      return 'environment.connectorUpgradeRequired';
    }
    case 'The device must be online and support directory verification': {
      return 'environment.directoryUnavailable';
    }
    case 'Unsupported Channel runtime': {
      return 'environment.unsupportedRuntime';
    }
    case 'Agent not found': {
      return 'environment.agentUnavailable';
    }
    default: {
      if (status === 401) return 'environment.signInRequired';
      if (status === 403) return 'environment.permissionRequired';
      return 'environment.saveFailed';
    }
  }
};
