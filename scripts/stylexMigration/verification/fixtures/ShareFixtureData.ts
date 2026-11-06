const notExercised = () => {
  throw new Error('BUSINESS_ACTION_OUTSIDE_STYLE_FIXTURE');
};

export const useShareData = () => ({
  dbMessages: [],
  displayMessages: [],
  systemRole: '',
  title: 'Fixture topic',
});
export const useExportMessages = () => ({ isHydrating: false, isIncomplete: false, messages: [] });
export const generateMarkdown = () => '# Fixture topic\n\nA short exported conversation.';
export const exportFile = notExercised;
export const formatSize = (size: number) => `${size} B`;
