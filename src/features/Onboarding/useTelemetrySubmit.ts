import { useCallback, useRef, useState } from 'react';

interface UseTelemetrySubmitOptions {
  initialTelemetryEnabled: boolean;
  onNext: () => Promise<void> | void;
  updateGeneralConfig: (general: { telemetry: boolean }) => Promise<void>;
}

export const useTelemetrySubmit = ({
  initialTelemetryEnabled,
  onNext,
  updateGeneralConfig,
}: UseTelemetrySubmitOptions) => {
  const [hasSaveError, setHasSaveError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [telemetryEnabled, setTelemetryEnabledState] = useState(initialTelemetryEnabled);
  const isSavingRef = useRef(false);

  const setTelemetryEnabled = useCallback((enabled: boolean) => {
    if (isSavingRef.current) return;

    setTelemetryEnabledState(enabled);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (isSavingRef.current) return;

    isSavingRef.current = true;
    setHasSaveError(false);
    setIsSaving(true);

    try {
      await updateGeneralConfig({ telemetry: telemetryEnabled });
      await onNext();
    } catch (error) {
      console.error('[Onboarding] Failed to save telemetry preference:', error);
      setHasSaveError(true);
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }, [onNext, telemetryEnabled, updateGeneralConfig]);

  return {
    handleSubmit,
    hasSaveError,
    isSaving,
    setTelemetryEnabled,
    telemetryEnabled,
  };
};
