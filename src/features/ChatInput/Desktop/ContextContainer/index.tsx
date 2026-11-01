import { Flexbox } from '@lobehub/ui';

import ContextList from './ContextList';

/**
 * Contains the context item to be attached, such as file, image, text, etc.
 * Note: Drag upload is now handled by DragUploadZone in the parent Desktop component.
 */
const ContextContainer = () => {
  return (
    <Flexbox paddingInline={8}>
      <ContextList />
    </Flexbox>
  );
};

export default ContextContainer;
