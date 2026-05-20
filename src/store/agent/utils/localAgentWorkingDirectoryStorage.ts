const LOCAL_AGENT_WORKING_DIRECTORY_KEY = 'lobechat-local-agent-working-directories';

const getStorage = (): Storage | undefined => {
  if (typeof window === 'undefined') return;
  return window.localStorage;
};

const readMap = (): Record<string, string> => {
  const storage = getStorage();
  if (!storage) return {};

  try {
    const raw = storage.getItem(LOCAL_AGENT_WORKING_DIRECTORY_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === 'string' && typeof entry[1] === 'string' && !!entry[1],
      ),
    );
  } catch {
    return {};
  }
};

const writeMap = (value: Record<string, string>) => {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(LOCAL_AGENT_WORKING_DIRECTORY_KEY, JSON.stringify(value));
};

export const getLocalAgentWorkingDirectory = (agentId: string): string | undefined => {
  if (!agentId) return;
  return readMap()[agentId];
};

export const setLocalAgentWorkingDirectory = (agentId: string, workingDirectory?: string): void => {
  if (!agentId) return;

  const map = readMap();

  if (workingDirectory) {
    map[agentId] = workingDirectory;
  } else {
    delete map[agentId];
  }

  writeMap(map);
};
