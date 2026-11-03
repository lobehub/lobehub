// Fixture: canonical agent-topic and image-topic links, plus an external URL.
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useNavigate } from 'react-router-dom';

interface LinksProps {
  agentId: string;
  imageTopicId: string;
  topicId: string;
}

const Links = memo<LinksProps>(({ agentId, imageTopicId, topicId }) => {
  const navigate = useNavigate();

  return (
    <Flexbox horizontal gap={8}>
      <span onClick={() => navigate(`/agent/${agentId}/${topicId}`)}>open</span>
      <span onClick={() => navigate(`/image?topic=${imageTopicId}`)}>image</span>
      <a href={'https://github.com/lobehub/lobehub'} rel="noreferrer" target="_blank">
        repo
      </a>
    </Flexbox>
  );
});

export default Links;
