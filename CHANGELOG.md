# @chatlychat/widget-testing

## 0.1.6 — 2026-10-28

- `la` in `CHATLY_STORAGE_NAMES` and `CHATLY_STORAGE_SPECS`: the launcher-appearance cache the widget reads BEFORE first paint, so a consent harness that enumerates our storage keys was missing one. Same list the API's `storage-declaration` contract publishes.

## 0.1.5 — 2026-10-28

### Changed

- The asserted method surface gains **`setCart`** and **`trackSale`**, so a
  test kit pinned to this version fails against a widget build that is missing
  either — which is the whole point of the kit asserting the surface by name.
- The storage manifest gains **`chatly:la:<publicId>`**, the launcher-appearance
  cache. `CHATLY_STORAGE_NAMES` and `CHATLY_STORAGE_SPECS` both list it, and
  `parity.spec.ts` reads the real manifest off disk, so an integrator's copy of
  our storage keys still cannot drift from ours.

### Note on these two versions

0.1.4 and 0.1.5 were both in `package.json` with no entry here.

## 0.1.3 — 2026-10-27

No behaviour change. **0.1.2 and every version before it were published without a provenance attestation**, because they went out from a machine rather than from the mirror's `publish.yml` on a tag — the same gap found in `@chatlychat/cli@0.5.1`/`0.5.2`. npm cannot add an attestation to an already-published version, so the only fix is a release. This is it.

Verify with `npm view @chatlychat/widget-testing@0.1.3 dist.attestations`, or `npm audit signatures` after installing. `0.1.2` stays on the registry and stays unattested; nothing about its contents is in doubt, it simply cannot be proven to have been built from this source.

## 0.1.2 — 2026-10-25

`setConsent({ functional, analytics, marketing })`: tell the widget a consent decision from any consent banner, including your own. `consent: 'auto'` now reads the major CMPs (IAB TCF v2.2, Google Consent Mode v2, Cookiebot, OneTrust, Cookie Munch and others), not one vendor.

## 0.1.1 — 2026-10-25

The published type declarations no longer say "NOT PUBLISHED": the header now states the package is released and supported.

## 0.1.0 — 2026-10-25

First public release. Assert against the Chatly widget embed in CI, with no network and no account. Zero dependencies.
