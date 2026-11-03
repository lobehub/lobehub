export interface ParsedTaskContent {
  activities?: string[];
  agent?: string;
  dependencies?: string;
  description?: string;
  identifier?: string;
  instruction?: string;
  name?: string;
  parent?: string;
  parentTaskBlock?: string;
  priority?: string;
  review?: string;
  reviewRubrics?: string[];
  status?: string;
  statusIcon?: string;
  subtasks?: string[];
  topics?: string;
  workspace?: string[];
}

const SECTION_KEYS = new Set(['Activities:', 'Subtasks:', 'Workspace', 'Review', 'Review:']);

const splitStatus = (raw: string): { icon?: string; status: string } => {
  const trimmed = raw.trim();
  if (!trimmed) return { status: '' };
  const [first, ...rest] = trimmed.split(/\s+/);
  if (rest.length === 0) return { status: first };
  // Heuristic: first token is non-ascii (icon) or short symbol → treat as icon.
  if (first.length <= 2 || !/^[A-Z]/i.test(first)) {
    return { icon: first, status: rest.join(' ') };
  }
  return { status: trimmed };
};

const isSectionHeader = (line: string): boolean => {
  if (SECTION_KEYS.has(line.trim())) return true;
  if (/^Workspace\s*\(/.test(line)) return true;
  if (/^Review\s*\(/.test(line)) return true;
  return false;
};

const isFieldLine = (line: string): boolean => {
  return /^[A-Z][A-Za-z]*:\s/.test(line);
};

export const parseTaskContent = (raw: string): ParsedTaskContent => {
  if (!raw) return {};

  // Strip the <hint>...</hint> block if present.
  const cleaned = raw.replaceAll(/<hint>[\S\s]*?<\/hint>/g, '').trim();
  const lines = cleaned.split('\n');

  const result: ParsedTaskContent = {};
  let i = 0;

  const skipBlankLines = () => {
    while (i < lines.length && lines[i].trim() === '') i++;
  };

  // Title line: "<identifier> <name...>" or just "<identifier>"
  skipBlankLines();
  const titleLine = lines[i]?.trim();
  if (titleLine) {
    const spaceIdx = titleLine.indexOf(' ');
    if (spaceIdx === -1) {
      result.identifier = titleLine;
    } else {
      result.identifier = titleLine.slice(0, spaceIdx);
      result.name = titleLine.slice(spaceIdx + 1).trim();
    }
    i++;
  }

  // Field block until the first blank line or a section header.
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      break;
    }
    if (isSectionHeader(line)) break;

    if (line.startsWith('Status:')) {
      const rest = line.slice('Status:'.length).trim();
      const priorityMarker = ' Priority:';
      const priorityIdx = rest.indexOf(priorityMarker);
      if (priorityIdx === -1) {
        const { icon, status } = splitStatus(rest);
        result.statusIcon = icon;
        result.status = status;
      } else {
        const statusPart = rest.slice(0, priorityIdx).trimEnd();
        const priorityPart = rest.slice(priorityIdx + priorityMarker.length).trim();
        const { icon, status } = splitStatus(statusPart);
        result.statusIcon = icon;
        result.status = status;
        result.priority = priorityPart;
      }
      i++;
      continue;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx > 0 && /^[A-Z][A-Za-z]*$/.test(line.slice(0, colonIdx))) {
      const key = line.slice(0, colonIdx).toLowerCase() as keyof ParsedTaskContent;
      let value = line.slice(colonIdx + 1).trim();

      // For Instruction / Description, accumulate continuation lines until a
      // blank line, another field, or a section header.
      if (key === 'instruction' || key === 'description') {
        i++;
        while (i < lines.length) {
          const next = lines[i];
          if (next.trim() === '') break;
          if (isFieldLine(next) || isSectionHeader(next)) break;
          value += '\n' + next;
          i++;
        }
        (result as any)[key] = value.trim();
        continue;
      }

      switch (key) {
        case 'agent':
        case 'parent':
        case 'topics':
        case 'dependencies': {
          (result as any)[key] = value;
          break;
        }
        // No default
      }
      i++;
      continue;
    }
    i++;
  }

  // Section parsing.
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }

    if (line.startsWith('Subtasks:')) {
      i++;
      const block: string[] = [];
      while (i < lines.length && /^\s+\S/.test(lines[i])) {
        block.push(lines[i].replace(/^\s{2}/, ''));
        i++;
      }
      result.subtasks = block;
      continue;
    }

    if (/^Review(?:\s*\(|:)/.test(line)) {
      const header = line.trim();
      i++;
      const rubrics: string[] = [];
      while (i < lines.length && /^\s+-/.test(lines[i])) {
        rubrics.push(lines[i].trim().replace(/^-\s*/, ''));
        i++;
      }
      if (rubrics.length > 0) {
        result.review = header;
        result.reviewRubrics = rubrics;
      } else {
        result.review = header.replace(/^Review:\s*/, '').replace(/^Review\s*/, '');
      }
      continue;
    }

    if (/^Workspace\s*\(/.test(line)) {
      i++;
      const block: string[] = [];
      while (i < lines.length && /^\s+\S/.test(lines[i])) {
        block.push(lines[i]);
        i++;
      }
      result.workspace = block;
      continue;
    }

    if (line.startsWith('Activities:')) {
      i++;
      const block: string[] = [];
      while (i < lines.length && /^\s+\S/.test(lines[i])) {
        block.push(lines[i].trim());
        i++;
      }
      result.activities = block;
      continue;
    }

    if (line.startsWith('<parentTask')) {
      const block: string[] = [line];
      i++;
      while (i < lines.length) {
        block.push(lines[i]);
        if (lines[i].trim() === '</parentTask>') {
          i++;
          break;
        }
        i++;
      }
      result.parentTaskBlock = block.join('\n');
      continue;
    }

    i++;
  }

  return result;
};
