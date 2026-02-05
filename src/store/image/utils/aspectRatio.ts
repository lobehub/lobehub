import type {ModelParamsSchema} from 'model-bank';

/**
 * Calculate initial aspect ratio for image generation models
 * @param parametersSchema - The model's parameter schema
 * @param defaultValues - Default parameter values from the model
 * @returns Initial aspect ratio string or null if not applicable
 */
export const calculateInitialAspectRatio = (
  parametersSchema: ModelParamsSchema,
  defaultValues: Record<string, any>,
): string | null => {
  // If model has native aspect ratio or size parameters, don't use virtual ratio control
  if (parametersSchema?.aspectRatio || parametersSchema?.size) {
    return null;
  }

  // If model doesn't have width/height parameters, no virtual ratio needed
  if (!parametersSchema?.width || !parametersSchema?.height) {
    return null;
  }

  const { width, height } = defaultValues;

  // Ensure we have valid numeric width and height values
  if (typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0) {
    return `${width}:${height}`;
  }

  // Default fallback ratio
  return '1:1';
};

/**
 * Check if a model supports virtual aspect ratio control
 * Virtual aspect ratio is enabled when model has width/height but no native aspect ratio/size controls
 */
export const supportsVirtualAspectRatio = (parametersSchema: ModelParamsSchema): boolean => {
  return (
    !parametersSchema?.aspectRatio &&
    !parametersSchema?.size &&
    !!parametersSchema?.width &&
    !!parametersSchema?.height
  );
};
