// generate('1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 16); //=> "4f90d13a42"
import { customAlphabet } from 'nanoid/non-secure';

export const createNanoId = (size = 8) =>
  customAlphabet('1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', size);

export const nanoid = createNanoId();

export { v4 as uuid } from 'uuid';
