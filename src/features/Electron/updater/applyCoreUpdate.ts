import { rendererOtaService } from '@/services/electron/rendererOta';

export const applyCoreUpdate = async (onFailure: () => void) => {
  try {
    if (await rendererOtaService.applyNow()) return true;
  } catch (error) {
    console.error('Failed to apply core update:', error);
  }
  onFailure();
  return false;
};
