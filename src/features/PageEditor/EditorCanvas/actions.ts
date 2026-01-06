export function openFileSelector(handleFiles: (files: FileList) => void, accept = '*/*') {
  // Skip on server side
  if (typeof document === 'undefined') {
    return;
  }

  // Create a hidden input element
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept; // Accept all file types
  input.multiple = false; // Whether to allow multiple selection

  // Listen for file selection events
  // eslint-disable-next-line unicorn/prefer-add-event-listener
  input.onchange = (event) => {
    // @ts-expect-error not error
    const files = event.target?.files;
    if (files && files.length > 0) {
      // Handle selected files
      handleFiles(files);
    }
  };

  // Trigger file selector
  input.click();
}
