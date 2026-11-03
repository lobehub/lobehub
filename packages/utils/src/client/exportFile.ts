export const exportFile = (content: string, filename?: string) => {
  // Create a Blob object
  const blob = new Blob([content], { type: 'plain/text' });

  // Create a URL object for download
  const url = URL.createObjectURL(blob);

  // Create an <a> element, set download link and filename
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'file.txt';

  // Trigger the click event of the <a> element to start download
  document.body.append(a);
  a.click();

  // After download is complete, clear the URL object
  URL.revokeObjectURL(url);
  a.remove();
};

export const exportJSONFile = (data: object, fileName: string) => {
  // Create a Blob object
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });

  // Create a URL object for download
  const url = URL.createObjectURL(blob);

  // Create an <a> element, set download link and filename
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;

  // Trigger the click event of the <a> element to start download
  document.body.append(a);
  a.click();

  // After download is complete, clear the URL object
  URL.revokeObjectURL(url);
  a.remove();
};
