import { type State } from '../../initialState';

const atBottom = (s: State) => s.atBottom;
const isScrolling = (s: State) => s.isScrolling;
const activeIndex = (s: State) => s.activeIndex;
const visibleItems = (s: State) => s.visibleItems;
const virtuaScrollMethods = (s: State) => s.virtuaScrollMethods;

export const virtuaListSelectors = {
  activeIndex,
  atBottom,
  isScrolling,
  virtuaScrollMethods,
  visibleItems,
};
