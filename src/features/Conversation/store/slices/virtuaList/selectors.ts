import { type State } from '../../initialState';

const atBottom = (s: State) => s.atBottom;
const autoScrollDetached = (s: State) => s.autoScrollDetached;
const isScrolling = (s: State) => s.isScrolling;
const activeIndex = (s: State) => s.activeIndex;
const visibleItems = (s: State) => s.visibleItems;
const virtuaScrollMethods = (s: State) => s.virtuaScrollMethods;

export const virtuaListSelectors = {
  activeIndex,
  atBottom,
  autoScrollDetached,
  isScrolling,
  virtuaScrollMethods,
  visibleItems,
};
