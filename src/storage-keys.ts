/**
 * The seven keys the visitor widget can write to a browser, and the one
 * assertion an integrator actually wants: **nothing of ours is in storage.**
 *
 * ── Why the list is restated here and how it is kept honest ──────────────
 *
 * `@livechat/shared`'s `WIDGET_STORAGE_KEYS` is the manifest, and
 * `scripts/check-widget-storage-manifest.mjs` holds it against the keys
 * `apps/widget/src` actually writes, in both directions, including which
 * store each goes to. This package cannot import it: `@livechat/shared` is a
 * private monorepo package, and an internal import in a package an integrator
 * installs typechecks, passes every test and breaks at install — a failure
 * this repo has already shipped once.
 *
 * So the names are restated, and `parity.spec.ts` reads the real manifest off
 * disk and fails if the two sets differ. That is the difference between this
 * kit and the hand-written fake it exists to replace: an integrator's copy of
 * our storage keys drifts silently, and this one cannot.
 */

/** The short names, as `chatly:<name>[:<publicId>]`. */
export const CHATLY_STORAGE_NAMES = ['vt', 'vh', 'xid', 'vr', 'drag', 'seen', 'utm'] as const;

export type ChatlyStorageName = (typeof CHATLY_STORAGE_NAMES)[number];

/**
 * Which of the two stores each key goes to, and whether it is suffixed with
 * the channel's `publicId`.
 *
 * `utm` is the one that is NOT in `localStorage` — it is a `sessionStorage`
 * key, because campaign attribution is a tab-session fact — and the store is
 * part of this table rather than assumed for exactly that reason. The first
 * draft of this file guessed `seen` instead, and `parity.spec.ts` caught it
 * on its first run against the real manifest, which is the mechanism working
 * and is why a restated list is allowed here at all.
 */
export const CHATLY_STORAGE_SPECS: ReadonlyArray<{
  readonly name: ChatlyStorageName;
  readonly store: 'localStorage' | 'sessionStorage';
  readonly scoped: boolean;
}> = [
  { name: 'vt', store: 'localStorage', scoped: true },
  { name: 'vh', store: 'localStorage', scoped: true },
  { name: 'xid', store: 'localStorage', scoped: true },
  { name: 'vr', store: 'localStorage', scoped: true },
  { name: 'drag', store: 'localStorage', scoped: true },
  { name: 'seen', store: 'localStorage', scoped: false },
  { name: 'utm', store: 'sessionStorage', scoped: false },
];

/**
 * Every literal key the widget could write for `publicId`.
 *
 * With no `publicId` the scoped keys come back as their unsuffixed prefix,
 * which is not a key the widget writes — so pass the public id when you have
 * it and use `findChatlyStorage` when you do not.
 */
export function chatlyStorageKeys(publicId?: string): string[] {
  return CHATLY_STORAGE_SPECS.map((spec) =>
    spec.scoped && publicId !== undefined && publicId.length > 0
      ? `chatly:${spec.name}:${publicId}`
      : `chatly:${spec.name}`,
  );
}

/** The prefix every key of ours starts with. Nothing else may be assumed. */
export const CHATLY_STORAGE_PREFIX = 'chatly:';
