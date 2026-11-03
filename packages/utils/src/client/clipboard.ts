const copyUsingFallback = (imageUrl: string) => {
  const img = new Image();
  img.addEventListener('load', function () {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx!.drawImage(img, 0, 0);

    try {
      canvas.toBlob(function (blob) {
        // @ts-ignore
        const item = new ClipboardItem({ 'image/png': blob });
        navigator.clipboard.write([item]).then(function () {
          console.log('Image copied to clipboard successfully using canvas and modern API');
        });
      });
    } catch {
      // If toBlob or ClipboardItem is not supported, use data URL
      const dataURL = canvas.toDataURL('image/png');
      const textarea = document.createElement('textarea');
      textarea.value = dataURL;
      document.body.append(textarea);
      textarea.select();

      document.execCommand('copy');

      textarea.remove();
    }
  });
  img.src = imageUrl;
};

const copyUsingModernAPI = async (imageUrl: string) => {
  try {
    const base64Response = await fetch(imageUrl);
    const blob = await base64Response.blob();
    const item = new ClipboardItem({ 'image/png': blob });
    await navigator.clipboard.write([item]);
  } catch (error) {
    console.error('Failed to copy image using modern API:', error);
    copyUsingFallback(imageUrl);
  }
};

export const copyImageToClipboard = async (imageUrl: string) => {
  // Check if modern Clipboard API is supported
  if (navigator.clipboard && 'write' in navigator.clipboard) {
    await copyUsingModernAPI(imageUrl);
  } else {
    copyUsingFallback(imageUrl);
  }
};
