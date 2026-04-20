import type { AiModelForSelect } from 'model-bank';

import GenerationModelItem from '@/routes/(main)/(create)/components/GenerationModelItem';

type ImageModelItemProps = AiModelForSelect & {
  providerId?: string;
  showBadge?: boolean;
  showPopover?: boolean;
};

const ImageModelItem = (props: ImageModelItemProps) => (
  <GenerationModelItem {...props} showPrice={true} />
);

export default ImageModelItem;
