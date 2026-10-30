import {
  defaultDropAnimationSideEffects,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
} from '@dnd-kit/core';

export const sortableRowDropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.4' } } }),
};

// The row is a link: a click fires on pointerup after a drag, so swallow the
// one click that follows a drop instead of navigating to the dragged row.
export const suppressNextClick = () => {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener('click', swallow, { capture: true, once: true });
  // A drop that lands off the row produces no click; don't eat a later one.
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
};

// Pressing on a row's own buttons (the ⋯ menu) must never pick the row up.
const startsOnRowAction = (event: Event) =>
  event.target instanceof Element && !!event.target.closest('.nav-item-actions');

export class RowMouseSensor extends MouseSensor {
  static activators = [
    {
      eventName: 'onMouseDown' as const,
      handler: ({ nativeEvent }: { nativeEvent: MouseEvent }) =>
        nativeEvent.button === 0 && !startsOnRowAction(nativeEvent),
    },
  ];
}

// A keyboard drag starts only from the focused row itself. Enter / Space on
// anything inside it — the row link, the ⋯ button — keeps its own meaning
// (open the row, open the menu).
const isRowItself = (event: Event) =>
  event.target instanceof Element &&
  event.target.getAttribute('aria-roledescription') === 'sortable';

export class RowKeyboardSensor extends KeyboardSensor {
  static activators = KeyboardSensor.activators.map((activator) => ({
    ...activator,
    handler: (...args: Parameters<typeof activator.handler>) =>
      isRowItself(args[0].nativeEvent) && activator.handler(...args),
  }));
}

export class RowTouchSensor extends TouchSensor {
  static activators = [
    {
      eventName: 'onTouchStart' as const,
      handler: ({ nativeEvent }: { nativeEvent: TouchEvent }) => !startsOnRowAction(nativeEvent),
    },
  ];
}
