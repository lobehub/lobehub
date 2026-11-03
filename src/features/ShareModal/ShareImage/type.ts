import { type ImageType } from '@/hooks/useScreenshot';

export enum WidthMode {
  Narrow = 'narrow',
  Wide = 'wide',
}

export type FieldType = {
  imageType: ImageType;
  widthMode: WidthMode;
  withBackground: boolean;
  withFooter: boolean;
  withPluginInfo: boolean;
  withSystemRole: boolean;
};
