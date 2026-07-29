export const FILE_DATE_WIDTH = 160;
export const FILE_SIZE_WIDTH = 140;
export const LIST_VIEW_MIN_WIDTH = 1040;
export const LIST_VIEW_MIN_WIDTH_WITHOUT_UPLOADER = 860;

export const getListViewMinWidth = (showUploader: boolean) =>
  showUploader ? LIST_VIEW_MIN_WIDTH : LIST_VIEW_MIN_WIDTH_WITHOUT_UPLOADER;
