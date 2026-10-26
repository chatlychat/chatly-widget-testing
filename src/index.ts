/**
 * `@chatlychat/widget-testing` — assert against the Chatly embed in CI, with
 * no network and no account (CHT-D09, CHT-F03; ADR 0067 §4).
 *
 * ── What is here, and what is deliberately not ───────────────────────────
 *
 * TWO fixtures, and which one a test wants depends on which half of the
 * embed it is asserting about.
 *
 * `installChatlyMock` is a faithful stand-in for `window.Chatly`. Not a
 * browser, not a renderer and not a server: it answers "what did my page
 * call, in what order, what did the embed's state become, and what landed in
 * storage", which is the whole of the integration contract and is the part an
 * integrator can get wrong on their own.
 *
 * `installChatlyEmbed` is the opposite trade — the REAL `loader.js` and
 * `widget.js`, byte for byte, in a real browser, with the SERVER faked. It is
 * what answers the three CHT-D09 assertions that are facts about the
 * loader's own lazy decision (which script was fetched, and when), because no
 * stand-in can answer those: the thing under test is the loader. It needs a
 * browser driver, which this package does not depend on and takes as a
 * structural argument — see `route-host.ts`.
 *
 * It is pinned to the real embed by `parity.spec.ts`, which reads the method
 * surface out of `packages/sdk-js/src/widget-api.ts` and the storage keys out
 * of `@livechat/shared`'s manifest. That is the only reason this is worth
 * shipping rather than letting every integrator keep their own fake: a fake
 * drifts silently, and this one fails our build when the embed moves.
 *
 * ── RELEASED AND SUPPORTED ──────────────────────────────────────────────
 *
 * Public on npm since 0.1.0 (2026-10-25) and supported like Chatly's other
 * packages: the parity specs run in Chatly's own build, so a change to the
 * embed that this kit does not follow fails there before it reaches you.
 */
export { readStore } from './host.js';
export type { HostWindow, StorageLike } from './host.js';

export { classifyScript, installChatlyEmbed } from './embed-fixture.js';
export type {
  ChatlyEmbedFixture,
  ChatlyEmbedOptions,
  EmbedRequest,
  EmbedScriptSource,
} from './embed-fixture.js';

export {
  CHATLY_STORAGE_SNAPSHOT_SOURCE,
  capturedHost,
  chatlyStorageSeedSource,
  readChatlyStorageSnapshot,
} from './page-bridge.js';
export type { ChatlyStorageSnapshot } from './page-bridge.js';

export type {
  RouteFulfillment,
  RouteHandler,
  RouteHost,
  RouteLike,
  RouteRequestLike,
} from './route-host.js';

export { createRouteRecorder, globToRegExp } from './route-recorder.js';
export type { RecorderOutcome, RecorderRequest, RouteRecorder } from './route-recorder.js';

export {
  WIDGET_FEATURE_DEFAULTS,
  WIRE_IDS,
  WIDGET_QUICK_REACTIONS,
  chatlyConversationListResponse,
  chatlyInitResponse,
  chatlyMessageListResponse,
  chatlyWireResponse,
  wireMessageId,
} from './wire-fixture.js';
export type { ChatlyWireOptions, WireIdentity, WireResponse } from './wire-fixture.js';

export { expectPanelClosed, expectPanelOpen, installChatlyMock } from './mock.js';
export type {
  ChatlyCall,
  ChatlyMock,
  ChatlyMockOptions,
  ChatlyMockState,
  MockIdentity,
} from './mock.js';

export { clearChatlyStorage, expectNoChatlyStorage, findChatlyStorage } from './storage.js';
export type { FoundStorageKey } from './storage.js';

export {
  CHATLY_STORAGE_NAMES,
  CHATLY_STORAGE_PREFIX,
  CHATLY_STORAGE_SPECS,
  chatlyStorageKeys,
} from './storage-keys.js';
export type { ChatlyStorageName } from './storage-keys.js';

export { CHATLY_METHODS, CHATLY_SHIM_PROPERTIES, isChatlyMethod } from './surface.js';
export type { ChatlyMethod } from './surface.js';
