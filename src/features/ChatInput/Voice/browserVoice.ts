export const canUseBrowserSpeechRecognition = () => {
  if (typeof window === 'undefined') return false;

  return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
};

export const canUseBrowserSpeechSynthesis = () => {
  if (typeof window === 'undefined') return false;

  return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
};

export const speakWithBrowser = (text: string) =>
  new Promise<void>((resolve, reject) => {
    if (!canUseBrowserSpeechSynthesis()) {
      reject(new Error('Browser speech synthesis is not available'));
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => resolve();
    utterance.onerror = (event) => reject(new Error(event.error || 'Speech synthesis failed'));
    window.speechSynthesis.speak(utterance);
  });

export const cancelBrowserSpeech = () => {
  if (!canUseBrowserSpeechSynthesis()) return;

  window.speechSynthesis.cancel();
};
