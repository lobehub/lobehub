import { WidthMode } from '@/features/ShareModal/ShareImage/type';
import { type ImageType } from '@/hooks/useScreenshot';

export { WidthMode };

export type FieldType = {
  imageType: ImageType;
  widthMode: WidthMode;
  withBackground: boolean;
  withFooter: boolean;
};
