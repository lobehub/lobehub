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
