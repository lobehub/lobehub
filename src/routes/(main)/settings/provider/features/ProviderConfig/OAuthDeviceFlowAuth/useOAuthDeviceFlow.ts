'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';

type AuthState = 'idle' | 'requesting' | 'pending_user_auth' | 'polling' | 'success' | 'error';
type PollStatus = 'pending' | 'success' | 'expired' | 'denied' | 'slow_down';

interface DeviceCodeInfo {
  deviceCode: string;
  expiresIn: number;
  interval: number;
  userCode: string;
  verificationUri: string;
}

interface UseOAuthDeviceFlowOptions {
  onSuccess?: () => void;
  providerId: string;
}

interface UseOAuthDeviceFlowResult {
  cancelAuth: () => void;
  deviceCodeInfo?: DeviceCodeInfo;
  error?: string;
  startAuth: () => Promise<void>;
  state: AuthState;
}

export function useOAuthDeviceFlow({
  providerId,
  onSuccess,
}: UseOAuthDeviceFlowOptions): UseOAuthDeviceFlowResult {
  const [state, setState] = useState<AuthState>('idle');
  const [deviceCodeInfo, setDeviceCodeInfo] = useState<DeviceCodeInfo | undefined>();
  const [error, setError] = useState<string | undefined>();

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expiryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deviceCodeRef = useRef<string | null>(null);

  const initiateDeviceCode = lambdaQuery.oauthDeviceFlow.initiateDeviceCode.useMutation();
  const pollAuthStatus = lambdaQuery.oauthDeviceFlow.pollAuthStatus.useMutation();

  const clearTimers = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    if (expiryRef.current) {
      clearTimeout(expiryRef.current);
      expiryRef.current = null;
    }
  }, []);

  const cancelAuth = useCallback(() => {
    clearTimers();
    setState('idle');
    setDeviceCodeInfo(undefined);
    setError(undefined);
    deviceCodeRef.current = null;
  }, [clearTimers]);

  const startPolling = useCallback(
    (deviceCode: string, interval: number) => {
      setState('polling');

      const poll = async () => {
        try {
          const result = await pollAuthStatus.mutateAsync({
            deviceCode,
            providerId,
          });

          const status = result.status as PollStatus;

          switch (status) {
            case 'success': {
              clearTimers();
              setState('success');
              onSuccess?.();
              break;
            }
            case 'expired': {
              clearTimers();
              setState('error');
              setError('codeExpired');
              break;
            }
            case 'denied': {
              clearTimers();
              setState('error');
              setError('denied');
              break;
            }
            case 'slow_down': {
              // Increase polling interval
              if (pollingRef.current) {
                clearInterval(pollingRef.current);
                pollingRef.current = setInterval(poll, (interval + 5) * 1000);
              }
              break;
            }
            // 'pending' - continue polling
          }
        } catch {
          clearTimers();
          setState('error');
          setError('authError');
        }
      };

      // Start polling
      pollingRef.current = setInterval(poll, interval * 1000);

      // Also poll immediately
      poll();
    },
    [clearTimers, onSuccess, pollAuthStatus, providerId],
  );

  const startAuth = useCallback(async () => {
    setError(undefined);
    setState('requesting');

    try {
      const response = await initiateDeviceCode.mutateAsync({ providerId });

      const info: DeviceCodeInfo = {
        deviceCode: response.deviceCode,
        expiresIn: response.expiresIn,
        interval: response.interval,
        userCode: response.userCode,
        verificationUri: response.verificationUri,
      };

      setDeviceCodeInfo(info);
      deviceCodeRef.current = info.deviceCode;
      setState('pending_user_auth');

      // Set expiry timer
      expiryRef.current = setTimeout(() => {
        clearTimers();
        setState('error');
        setError('codeExpired');
      }, info.expiresIn * 1000);

      // Start polling after a brief delay to give user time to see the code
      setTimeout(() => {
        if (deviceCodeRef.current === info.deviceCode) {
          startPolling(info.deviceCode, info.interval);
        }
      }, 2000);
    } catch {
      setState('error');
      setError('authError');
    }
  }, [clearTimers, initiateDeviceCode, providerId, startPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  return {
    cancelAuth,
    deviceCodeInfo,
    error,
    startAuth,
    state,
  };
}
