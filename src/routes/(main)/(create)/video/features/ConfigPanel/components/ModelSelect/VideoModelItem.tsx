import type { AiModelForSelect } from 'model-bank';

import GenerationModelItem from '@/routes/(main)/(create)/components/GenerationModelItem';

type VideoModelItemProps = AiModelForSelect & {
  providerId?: string;
  showBadge?: boolean;
  showPopover?: boolean;
};

const VideoModelItem = (props: VideoModelItemProps) => (
  <GenerationModelItem {...props} priceKind="video" showPrice={true} />
);

export default VideoModelItem;
