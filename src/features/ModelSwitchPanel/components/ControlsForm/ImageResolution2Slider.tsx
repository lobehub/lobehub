import { type CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

const IMAGE_RESOLUTIONS_2 = ['512px', '1K', '2K', '4K'] as const;
type ImageResolution2 = (typeof IMAGE_RESOLUTIONS_2)[number];

export type ImageResolution2SliderProps = CreatedLevelSliderProps<ImageResolution2>;

const ImageResolution2Slider = createLevelSliderComponent<ImageResolution2>({
  configKey: 'imageResolution',
  defaultValue: '1K',
  levels: IMAGE_RESOLUTIONS_2,
  style: { minWidth: 190 },
});

export default ImageResolution2Slider;
