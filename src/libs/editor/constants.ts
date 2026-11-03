/**
 * Empty editor state for initializing the editor
 * This is the minimal JSON structure required by the editor
 * Must have at least one paragraph with an empty text node
 */
export const EMPTY_EDITOR_STATE = {
  root: {
    id: 'root',
    type: 'root',
    format: '',
    indent: 0,
    version: 1,
    children: [
      {
        id: '42',
        type: 'paragraph',
        format: '',
        indent: 0,
        version: 1,
        children: [],
        direction: null,
        textStyle: '',
        textFormat: 0,
      },
    ],
    direction: null,
  },
};
