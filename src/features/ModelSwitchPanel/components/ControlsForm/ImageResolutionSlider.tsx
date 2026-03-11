import { type CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

const IMAGE_RESOLUTIONS = ['1K', '2K', '4K'] as const;
type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number];

export type ImageResolutionSliderProps = CreatedLevelSliderProps<ImageResolution>;

const ImageResolutionSlider = createLevelSliderComponent<ImageResolution>({
  configKey: 'imageResolution',
  defaultValue: '1K',
  levels: IMAGE_RESOLUTIONS,
  style: { minWidth: 150 },
});

export default ImageResolutionSlider;
