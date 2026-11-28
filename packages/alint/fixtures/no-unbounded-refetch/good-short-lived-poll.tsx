// Fixture: a device-code login polls every 2 s but stops on success, denial
// or expiry; the 1 s elapsed-time tick does no request.
import { useEffect, useState } from 'react';

import { pollDeviceToken } from './api';

const POLL_MS = 2000;

export const useDeviceCodeLogin = (deviceCode: string, expiresAt: number) => {
  const [status, setStatus] = useState<'pending' | 'done' | 'denied' | 'expired'>('pending');

  useEffect(() => {
    if (status !== 'pending') return;
    const timer = setInterval(async () => {
      if (Date.now() > expiresAt) return setStatus('expired');
      const result = await pollDeviceToken(deviceCode);
      if (result.status !== 'pending') setStatus(result.status);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [deviceCode, expiresAt, status]);

  return status;
};

export const ElapsedTime = ({ startedAt }: { startedAt: number }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span>{Math.round((now - startedAt) / 1000)}s</span>;
};
