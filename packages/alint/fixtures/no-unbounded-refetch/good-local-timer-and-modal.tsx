// Fixture: a 4 s local timer that makes no request, and a 15 s device list
// poll inside a modal that is mounted only while it is open.
import { useEffect, useState } from 'react';

import { useDeviceList } from './useDeviceList';

export const useRotatingHint = (hints: string[]) => {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % hints.length), 4000);
    return () => clearInterval(timer);
  }, [hints.length]);
  return hints[index];
};

/** Rendered by `<Modal open={open}>{open && <AgentEnvironmentModalBody />}</Modal>`. */
export const AgentEnvironmentModalBody = () => {
  const { data: devices = [] } = useDeviceList({ refreshInterval: 15_000 });
  return (
    <ul>
      {devices.map((device) => (
        <li key={device.id}>{device.name}</li>
      ))}
    </ul>
  );
};
