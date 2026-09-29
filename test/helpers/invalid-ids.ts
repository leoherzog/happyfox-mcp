/** Id inputs that must never reach a HappyFox URL path. */

/** Attempts to steer a request to another endpoint through the id segment. */
export const INJECTION_IDS: unknown[] = [
  "123/delete/#",
  "123/delete/?",
  "123/move/#",
  "../users",
  "..",
  ".",
  "%2e%2e",
  "1?x=y",
  "1#x",
  "123\\delete\\?",
  "../ticket_custom_field/5/#",
  "../reports/#"
];

/** Values that are not positive integers, including display ids. */
export const MALFORMED_IDS: unknown[] = [
  "#HFS00000001",
  "0",
  "-1",
  "1.5",
  "12 3",
  " 12",
  "",
  "1e3",
  0,
  -4,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  2 ** 53,
  null,
  undefined,
  true,
  {},
  [1]
];
