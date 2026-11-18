/** A file read back from a skill's archive: text, or a binary one by size alone. */
export interface SkillArchiveFile {
  binary?: boolean;
  content: string;
  path: string;
  size: number;
}

/** One version of a user skill as it shipped: its `SKILL.md` and the files beside it. */
export interface UserSkillVersionDetail {
  content: string;
  /**
   * The files that version shipped. Absent on a version from before archives,
   * which kept only its `SKILL.md`: read the skill's current files.
   */
  files?: SkillArchiveFile[];
  note?: string;
  origin?: Record<string, unknown>;
  version: number;
}
