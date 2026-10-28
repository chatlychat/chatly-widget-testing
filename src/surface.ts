/**
 * The embed's public method names, restated, and kept honest by
 * `parity.spec.ts`.
 *
 * ── Why a list at all ────────────────────────────────────────────────────
 *
 * So that the mock can REFUSE a method the real widget does not have.
 * `Chatly('setLable', 'vip')` is the mistake an integrator actually makes,
 * and the real widget swallows it: the loader pushes the call onto `q`, the
 * bundle replays it, finds no such method and does nothing. No error, no
 * warning, and a label that never arrives. A test kit that reproduced that
 * silence faithfully would be reproducing the least useful thing about it.
 *
 * ── Why it is restated and not imported ──────────────────────────────────
 *
 * `ChatlyApi` lives in `packages/sdk-js/src/widget-api.ts`, and `sdk-js` is a
 * published package this one does not depend on; `@livechat/*` is private, so
 * importing from there would typecheck, pass every test and break at install.
 * `parity.spec.ts` reads that interface off disk and fails if these two sets
 * differ in either direction, which is the mechanism that makes a restated
 * list a fact rather than another copy.
 */

/**
 * Everything `Chatly(...)` accepts as its first argument.
 *
 * `q` and `publicId` are NOT here: they are properties on the shim, not
 * methods, which is the same distinction `apps/widget/scripts/dist-smoke.mjs`
 * makes when it asserts the built bundle's surface.
 */
export const CHATLY_METHODS = [
  'beforeMessageDisplay',
  'beforeMessageSent',
  'close',
  'deleteCustomAttribute',
  'destroy',
  'dismiss',
  'getUnreadCount',
  'hasSession',
  'identify',
  'init',
  'mount',
  'off',
  'on',
  'open',
  'registerPushToken',
  'removeLabel',
  'reportAction',
  'reset',
  'setCart',
  'setContext',
  'setCustomAttributes',
  'setLabel',
  'setLocale',
  'setConsent',
  'setOffset',
  'setStorageConsent',
  'setTheme',
  'setUser',
  'startConversation',
  'toggle',
  'track',
  'trackSale',
  'unmount',
] as const;

export type ChatlyMethod = (typeof CHATLY_METHODS)[number];

/** Shim PROPERTIES, which `ChatlyApi` declares beside the methods. */
export const CHATLY_SHIM_PROPERTIES = ['q', 'publicId'] as const;

const METHOD_SET: ReadonlySet<string> = new Set<string>(CHATLY_METHODS);

export function isChatlyMethod(name: string): name is ChatlyMethod {
  return METHOD_SET.has(name);
}
