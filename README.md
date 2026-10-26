# @chatlychat/widget-testing

Assert against the Chatly widget embed in CI — no network, no account, zero
dependencies.

```sh
npm install --save-dev @chatlychat/widget-testing
```

## Why this exists

Every integrator who end-to-end tests a page with Chatly on it writes the same
thirty lines: a `window.Chatly` stub that queues calls, flips a `ready` flag,
remembers whether the panel is open, and ignores an `open()` that arrived too
early.

One of them wrote it, shipped it, and the behaviour it encoded — _an `open()`
before ready is dropped_ — had stopped being true of the real widget. Their
suite was green against their own fake and told them nothing. That is CHT-D09,
and its own phrasing is the point: **every integrator's fake will drift from
the real widget.**

So the value here is not that it is a mock. It is that `src/parity.spec.ts`
reads the real sources — the embed's method surface out of
`packages/sdk-js/src/widget-api.ts`, the storage keys out of
`packages/shared/src/widget-config/storage.ts` — and fails Chatly's own build
in either direction. Add a method to the embed, or a storage key to the widget,
and this kit breaks here, before an integrator can be misled by it.

## What it does and does not answer

It answers the integration contract: **what did my page call, in what order,
what did the embed's state become, and what landed in storage.** That is the
part an integrator can get wrong on their own.

It is not a browser and not a renderer. It cannot tell you the panel is 372px
wide or that a card did not blow out the layout — that is
`apps/widget/scripts/dist-smoke.mjs`, which drives a real Chromium against the
built bundle and is not something an integrator can run.

## Use

```ts
import {
  installChatlyMock,
  expectPanelOpen,
  expectNoChatlyStorage,
  clearChatlyStorage,
} from '@chatlychat/widget-testing';

const mock = installChatlyMock(window, { publicId: 'pub_live_…' });

// The snippet's own calls, made before the bundle has loaded.
Chatly('init', { publicId: 'pub_live_…', storage: 'deny' });
Chatly('open');

// Nothing has happened yet — a call before load is QUEUED, not applied.
expectNoChatlyStorage(window);

// What the real loader does on its `onload`: replay the queue and empty it.
mock.load();
expectPanelOpen(mock);

// A consent banner's acceptance test.
expectNoChatlyStorage(window);

mock.uninstall();
clearChatlyStorage(window);
```

`installChatlyMock` takes any object with an optional `localStorage` and
`sessionStorage`, so the same code works in jsdom, inside Playwright's
`page.evaluate`, and in a bare Node process asserting over a captured object.
Nothing in `src/` names a DOM global; `tsconfig.src.json` builds with
`lib: ["ES2022"]` and `types: []` so that a reference would be a compile error,
and ESLint catches the `globalThis['window']` form a `lib` restriction does not.

## The three behaviours it is exact about

1. **A call before load is queued, not dropped.** The real snippet pushes into
   `Chatly.q` and the bundle replays it on boot, so an `open()` fired from a
   mount effect that runs before the async loader tag finishes _does_ open the
   panel. A fake that dropped it teaches its author to add a `setTimeout` they
   do not need.
2. **The queue is emptied on replay.** This is NCH-06. A replay that leaves `q`
   populated makes a later `destroy()` + re-`init()` replay the page's entire
   history, so one `startConversation()` becomes three.
3. **`hasSession()` answers before the bundle exists.** The real loader assigns
   it on the shim unconditionally and it reads `chatly:vr:<publicId>` — the same
   key the loaded bundle reads — so a host in manual mode can decide whether to
   load at all.

And one thing it deliberately does **not** reproduce: the real embed ignores an
unknown method, so `Chatly('setLable', 'vip')` queues, replays, matches nothing
and silently never applies the label. This kit throws. Faithfully reproducing
that silence would be reproducing the least useful thing about it.

## Releasing

Published from this monorepo by `scripts/publish-packages.mjs` (first release 0.1.0, 2026-10-25).
The parity specs read sibling monorepo paths, so they run here and nowhere else: if this package is
ever mirrored out (`scripts/sync-sdk-repos.mjs`), the mirror's CI cannot run them. `files` and
`tsconfig.build.json` exclude the specs, so no monorepo path reaches the tarball.

---

## About this repository

This is a **mirror**. `@chatlychat/widget-testing` is built from a private monorepo where the rest
of the platform, its migrations and its contract checks live, so a pull request here
cannot be merged directly — but a patch is still the fastest way to get something
fixed and we will port it with attribution.

What you can do here: read the source, run the tests, open an issue, or open a PR
and we will treat the diff as the proposal.

Not mirrored: src/parity.spec.ts, src/route-host.spec.ts — specs that assert a type restated here still
matches the monorepo's original, which is only a meaningful claim inside it. They
keep running there.

Issues: https://github.com/chatlychat/chatly-widget-testing/issues · Docs: https://chatlychat.com/docs
