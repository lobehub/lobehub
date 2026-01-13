/**
 * Image file validation utility functions
 */

/**
 * Format file size to human readable format
 * @param bytes - File size in bytes
 * @returns Formatted string like "1.5 MB"
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

export interface ValidationResult {
  // Additional details for error messages
  actualSize?: number;
  error?: string;
  fileName?: string;
  maxSize?: number;
  valid: boolean;
}

/**
 * Validate single image file size
 * @param file - File to validate
 * @param maxSize - Maximum file size in bytes, defaults to 10MB if not provided
 * @returns Validation result
 */
export const validateImageFileSize = (file: File, maxSize?: number): ValidationResult => {
  const defaultMaxSize = 10 * 1024 * 1024; // 10MB default limit
  const actualMaxSize = maxSize ?? defaultMaxSize;

  if (file.size > actualMaxSize) {
    return {
      actualSize: file.size,
      error: 'fileSizeExceeded',
      fileName: file.name,
      maxSize: actualMaxSize,
      valid: false,
    };
  }

  return { valid: true };
};

/**
 * Validate image count
 * @param count - Current image count
 * @param maxCount - Maximum allowed count, skip validation if not provided
 * @returns Validation result
 */
export const validateImageCount = (count: number, maxCount?: number): ValidationResult => {
  if (!maxCount) return { valid: true };

  if (count > maxCount) {
    return {
      error: 'imageCountExceeded',
      valid: false,
    };
  }

  return { valid: true };
};

/**
 * Validate image file list
 * @param files - File list
 * @param constraints - Constraint configuration
 * @returns Validation result, including validation result for each file
 */
export const validateImageFiles = (
  files: File[],
  constraints: {
    maxAddedFiles?: number;
    maxFileSize?: number;
  },
): {
  errors: string[];
  // Additional details for error messages
  failedFiles?: ValidationResult[];
  fileResults: ValidationResult[];
  valid: boolean;
} => {
  const errors: string[] = [];
  const fileResults: ValidationResult[] = [];
  const failedFiles: ValidationResult[] = [];

  // Validate file count
  const countResult = validateImageCount(files.length, constraints.maxAddedFiles);
  if (!countResult.valid && countResult.error) {
    errors.push(countResult.error);
  }

  // Validate each file
  files.forEach((file) => {
    const fileSizeResult = validateImageFileSize(file, constraints.maxFileSize);
    fileResults.push(fileSizeResult);

    if (!fileSizeResult.valid && fileSizeResult.error) {
      errors.push(fileSizeResult.error);
      failedFiles.push(fileSizeResult);
    }
  });

  return {
    errors: Array.from(new Set(errors)), // Remove duplicates
    failedFiles,
    fileResults,
    valid: errors.length === 0,
  };
};
