import { UNDO_WINDOW_MS } from './mailWrites';

interface OfferedUndo {
  id: number;
  undo: () => void;
}

let offered: OfferedUndo | undefined;
let lastId = 0;

/**
 * What `z` undoes: the last undo toast still on screen. Each toast that offers
 * an undo registers it here; the newest one wins, as only it is the "last step".
 */
export const offerUndo = (undo: () => void) => {
  const id = ++lastId;
  offered = { id, undo };
  const withdraw = () => {
    if (offered?.id === id) offered = undefined;
  };
  setTimeout(withdraw, UNDO_WINDOW_MS);

  return {
    /** For the toast's own button: the same undo, after which `z` has nothing left. */
    run: () => {
      withdraw();
      undo();
    },
    /** The toast closed with nothing to undo. */
    withdraw,
  };
};

/** Run the offered undo, if its window is still open. */
export const undoLast = () => {
  const current = offered;
  if (!current) return false;
  offered = undefined;
  current.undo();
  return true;
};
