/**
 * Copy-with-history rejected: the source group left this scope between the
 * ownership read and the row lock (a concurrent transfer committed).
 */
export const AGENT_GROUP_COPY_SOURCE_MOVED = 'AGENT_GROUP_COPY_SOURCE_MOVED';

/**
 * Transfer rejected: the group references a member agent this caller cannot
 * see, and moving the group would clone that agent — config and all — into a
 * scope the caller can read.
 */
export const GROUP_HAS_INACCESSIBLE_MEMBER = 'GROUP_HAS_INACCESSIBLE_MEMBER';
