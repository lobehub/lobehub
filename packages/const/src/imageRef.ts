/** Text the model receives for an inline image reference in a chat message, e.g. `[Image #2]`. */
export const formatImageRef = (number: number) => `[Image #${number}]`;

const IMAGE_REF_PATTERN = /\[Image #\d+\] ?/g;

/**
 * Removes inline image references (and the space written after each) from message text.
 * They point the model at an attached image but carry no topic, so text derived from a
 * message for people, such as a topic title, leaves them out.
 */
export const stripImageRefs = (text: string) => text.replaceAll(IMAGE_REF_PATTERN, '');
