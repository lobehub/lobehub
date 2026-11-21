import { type ChatTopic, type GroupedTopic } from '@/types/topic';
import { getTopicWorkingDirectorySourcePath } from '@/utils/client/topic';

export const NO_DIRECTORY_SECTION_ID = 'no-directory';
const DEVICE_GROUP_PREFIX = 'device:';
const NO_DEVICE_GROUP_ID = 'no-device';

/**
 * Whether a by-device group nests its topics by directory. An agent's topics
 * on one device spread over its directories, so the device leads and its
 * directories follow. A project-scoped list already is one project — its
 * directory on a device needs no row of its own — and synthetic buckets
 * (favorites) stay flat.
 */
export const sectionsDeviceGroupByDirectory = (groupId: string, projectScoped: boolean) =>
  !projectScoped && (groupId.startsWith(DEVICE_GROUP_PREFIX) || groupId === NO_DEVICE_GROUP_ID);
const DIRECTORY_SECTION_PREFIX = 'directory:';
const PATH_SECTION_PREFIX = 'path:';

export interface DirectorySection extends GroupedTopic {
  /** The project directory the section stands for, when its topics are bound to one. */
  directoryId?: string;
  /** The folder the section's newest topic works in. */
  path?: string;
}

interface DirectoryLike {
  id: string;
  name?: string | null;
  path?: string | null;
  projectName?: string | null;
}

const basename = (path: string) => path.split(/[/\\]+/).findLast(Boolean) ?? path;

/**
 * Section one device's topics by the directory they work in: a bound project
 * directory first, else the topic's own folder path. Sections keep the
 * incoming (sidebar-sorted) order, so the directory with the most recent topic
 * leads; topics without any directory trail in their own section. Returns
 * `undefined` when no topic has a directory, so the caller lists them flat.
 */
export const groupTopicsByDirectory = (topics: ChatTopic[]): DirectorySection[] | undefined => {
  const sections = new Map<string, DirectorySection>();
  const loose: ChatTopic[] = [];

  for (const topic of topics) {
    const path = getTopicWorkingDirectorySourcePath(topic);
    const directoryId = topic.projectWorkingDirectoryId ?? undefined;
    const id = directoryId
      ? `${DIRECTORY_SECTION_PREFIX}${directoryId}`
      : path
        ? `${PATH_SECTION_PREFIX}${path}`
        : undefined;
    if (!id) {
      loose.push(topic);
      continue;
    }
    const existing = sections.get(id);
    if (existing) {
      existing.children.push(topic);
      existing.path ??= path;
    } else {
      sections.set(id, { children: [topic], directoryId, id, path });
    }
  }

  // Sections only tell directories apart: a device without any directory
  // lists its topics directly instead of nesting them under "No directory".
  if (sections.size === 0) return undefined;
  const result = [...sections.values()];
  if (loose.length) result.push({ children: loose, id: NO_DIRECTORY_SECTION_ID });
  return result;
};

/**
 * A project directory reads as its project; a bare folder as its last path
 * segment. A directory the registry no longer lists falls back to its folder,
 * and only without one to the unknown label — never an empty title.
 */
export const directorySectionTitle = (
  section: DirectorySection,
  directories: DirectoryLike[],
  labels: { noDirectory: string; unknownDirectory: string },
): string => {
  if (section.id === NO_DIRECTORY_SECTION_ID) return labels.noDirectory;
  const directory = section.directoryId
    ? directories.find((item) => item.id === section.directoryId)
    : undefined;
  const path = directory?.path || section.path;
  return (
    directory?.projectName || directory?.name || (path && basename(path)) || labels.unknownDirectory
  );
};

/** The full folder path, shown only to tell apart sections whose titles match. */
export const directorySectionTag = (
  section: DirectorySection,
  directories: DirectoryLike[],
): string | undefined => {
  const directory = section.directoryId
    ? directories.find((item) => item.id === section.directoryId)
    : undefined;
  return directory?.path || section.path || undefined;
};
