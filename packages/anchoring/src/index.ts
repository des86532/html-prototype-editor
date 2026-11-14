export { describe, lastClientRect, containerOf, type DescribeInput } from './describe.js';
export {
  resolve,
  rectForAnchor,
  fallbackResult,
  defaultIsVisible,
  type ResolveOptions,
  type ResolveResult,
} from './resolve.js';
export { cssPath } from './cssPath.js';
export { xpathOf, evalXPath } from './xpath.js';
export { buildTextIndex, findQuote, rangeFromIndex, type TextIndex } from './textQuote.js';
export { fingerprintOf, scoreFingerprint, textOf } from './fingerprint.js';
export { isHashLike, isStableClass, isStableId, defaultMeasure } from './util.js';
