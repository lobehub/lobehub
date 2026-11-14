import type { AiModelForSelect } from 'model-bank';

import GenerationModelItem from '@/routes/(main)/(create)/components/GenerationModelItem';

type MusicModelItemProps = AiModelForSelect & {
  providerId?: string;
  showBadge?: boolean;
  showPopover?: boolean;
};

const MusicModelItem = (props: MusicModelItemProps) => <GenerationModelItem {...props} />;

export default MusicModelItem;
