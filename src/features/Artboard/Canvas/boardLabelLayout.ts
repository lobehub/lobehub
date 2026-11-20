export const BOARD_LABEL_FONT = 12;
const BASE = 23;
const FOLLOW = 0.85;
const HIDE_BELOW = 0.11;
const MIN_SCREEN_WIDTH = 48;

const TAG_FONT = 10;
const STAR = 12;
const STAR_ROOM = STAR + 7;
const TITLE_MIN = 56;
const MIN_TAG_PX = 9;
const MIN_STAR_PX = 10;

const WIDE_CHAR =
  /[\u1100-\u11FF\u2E80-\u9FFF\uA960-\uA97F\uAC00-\uD7FF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;

export const textWidth = (text: string, fontSize: number) => {
  let units = 0;
  for (const char of text) units += WIDE_CHAR.test(char) ? 1 : 0.55;
  return units * fontSize;
};

export const TAG_CHROME = 16;
export const tagWidth = (text: string) => textWidth(text, TAG_FONT) + TAG_CHROME;

export const boardLabelScale = (k: number, boardWidth: number): number | null => {
  if (k < HIDE_BELOW || boardWidth * k < MIN_SCREEN_WIDTH) return null;
  return Math.min(BASE * k ** FOLLOW, BASE) / BOARD_LABEL_FONT;
};

export type RecommendMark = 'none' | 'star' | 'tag';

const recommendMark = (title: number, tag: number, room: number): RecommendMark => {
  if (title + tag <= room) return 'tag';
  return room - STAR_ROOM >= Math.min(title, TITLE_MIN) ? 'star' : 'none';
};

const readable = (mark: RecommendMark, scale: number) => {
  if (mark === 'tag') return TAG_FONT * scale >= MIN_TAG_PX;
  if (mark === 'star') return STAR * scale >= MIN_STAR_PX;
  return false;
};

interface BoardLabelInput {
  boardWidth: number;
  k: number;
  lead: number;
  recommended: boolean;
  tag: number;
  title: number;
  trail: number;
}

export interface BoardLabelLayout {
  badge: boolean;
  label: { mark: RecommendMark; scale: number; width: number } | null;
}

export const boardLabelLayout = ({
  boardWidth,
  k,
  lead,
  recommended,
  tag,
  title,
  trail,
}: BoardLabelInput): BoardLabelLayout => {
  const scale = boardLabelScale(k, boardWidth);
  if (scale === null) return { badge: recommended, label: null };
  const width = (boardWidth * k) / scale;
  const mark = recommended ? recommendMark(title, tag, width - lead - trail) : 'none';
  const shown = readable(mark, scale);
  return { badge: recommended && !shown, label: { mark: shown ? mark : 'none', scale, width } };
};

export const recommendBadge = (screenWidth: number) => {
  if (screenWidth < 20) return null;
  return screenWidth < 60 ? { icon: 8, inset: 4, size: 14 } : { icon: 11, inset: 8, size: 20 };
};
