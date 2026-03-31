import { memo } from 'react';

import type { ReferTopicNode } from './ReferTopicNode';
import { ReferTopicView } from './ReferTopicView';

interface ReferTopicProps {
  node: ReferTopicNode;
}

const ReferTopic = memo<ReferTopicProps>(({ node }) => {
  return <ReferTopicView fallbackTitle={node.topicTitle} topicId={node.topicId} />;
});

ReferTopic.displayName = 'ReferTopic';

export default ReferTopic;
