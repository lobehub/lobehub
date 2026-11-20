import { memo } from 'react';

import type { ReferDocumentNode } from './ReferDocumentNode';
import { ReferDocumentView } from './ReferDocumentView';

interface ReferDocumentProps {
  node: ReferDocumentNode;
}

const ReferDocument = memo<ReferDocumentProps>(({ node }) => {
  return <ReferDocumentView title={node.title} />;
});

ReferDocument.displayName = 'ReferDocument';

export default ReferDocument;
