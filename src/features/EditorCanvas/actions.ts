/**
 * Opens a native file selector dialog
 * @param handleFiles - Callback function to handle selected files
 * @param accept - MIME type filter for accepted files (default: all files)
 */
export function openFileSelector(handleFiles: (files: FileList) => void, accept = '*/*') {
  // Skip on server side
  if (typeof document === 'undefined') {
    return;
  }

  // Create a hidden input element
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.multiple = false;

  // Listen for file selection events
  input.addEventListener('change', (event) => {
    const files = (event.target as HTMLInputElement)?.files;
    if (files && files.length > 0) {
      handleFiles(files);
    }
  });

  // Trigger file selector
  input.click();
}
