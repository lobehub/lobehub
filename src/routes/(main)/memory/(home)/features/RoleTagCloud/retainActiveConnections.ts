export const retainActiveConnections = <T extends { birthTime: number; duration: number }>(
  connections: T[],
  time: number,
): T[] => {
  const active = connections.filter(
    (connection) => time - connection.birthTime < connection.duration,
  );
  return active.length === connections.length ? connections : active;
};
