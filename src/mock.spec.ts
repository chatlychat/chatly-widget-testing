/**
 * The mock's own behaviour — and in particular the three things every
 * hand-written integrator fake gets wrong.
 *
 * A note on what these tests ARE: they test this package, not the widget.
 * What ties the package to the widget is `parity.spec.ts`, which reads the
 * real sources. Both halves are needed, and only the second one catches
 * drift.
 */
import { describe, expect, it } from 'vitest';

import {
  expectPanelClosed,
  expectPanelOpen,
  installChatlyMock,
  type HostWindow,
  type StorageLike,
} from './index.js';

/** A `localStorage` double, because this package has no jsdom dependency. */
function memoryStore(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

function host(): HostWindow & { localStorage: ReturnType<typeof memoryStore> } {
  return { localStorage: memoryStore() };
}

const PID = 'pub_test_123';

describe('a call before load is QUEUED, not dropped', () => {
  it('replays it in order once the bundle loads', () => {
    /*
     * The real snippet is `w.Chatly = w.Chatly || function(){ (w.Chatly.q =
     * w.Chatly.q||[]).push(arguments) }`, and the bundle replays `q` on boot.
     * A fake that dropped an early `open()` taught its author to add a
     * `setTimeout` they did not need — and would hide a regression if the
     * real widget ever started dropping it.
     */
    const win = host();
    const mock = installChatlyMock(win, { publicId: PID });
    const chatly = win.Chatly as (...a: unknown[]) => void;

    chatly('init', { publicId: PID, storage: 'allow' });
    chatly('open', 'messages');

    expect(mock.state().ready).toBe(false);
    expect(mock.state().open).toBe(false);
    expect(mock.calls).toEqual([]);

    mock.load();

    expect(mock.calls.map((c) => c.method)).toEqual(['init', 'open']);
    expect(mock.calls.every((c) => c.queued)).toBe(true);
    expect(mock.state().open).toBe(true);
    expect(mock.state().view).toBe('messages');
  });

  it('dispatches live after load, and marks the calls as not queued', () => {
    const win = host();
    const mock = installChatlyMock(win, { publicId: PID, ready: true });
    (win.Chatly as (...a: unknown[]) => void)('open');
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.queued).toBe(false);
  });
});

describe('the queue is EMPTIED on replay (NCH-06)', () => {
  it('does not replay the page history a second time', () => {
    /*
     * The half that bites. A replay that leaves `q` populated makes a later
     * `destroy()` + re-`init()` replay every call the page has ever made, so
     * one `startConversation()` becomes three.
     */
    const win = host();
    const mock = installChatlyMock(win, { publicId: PID });
    const chatly = win.Chatly as (...a: unknown[]) => void;
    chatly('init', { publicId: PID });
    chatly('startConversation');

    mock.load();
    expect(mock.callsTo('startConversation')).toHaveLength(1);

    // The shim's own queue is empty, which is what a second boot would read.
    expect((win.Chatly as { q?: unknown[] }).q).toEqual([]);

    // And a second `load()` is a no-op rather than a second replay.
    mock.load();
    expect(mock.callsTo('startConversation')).toHaveLength(1);
  });
});

describe('hasSession() answers BEFORE the bundle loads', () => {
  it('reads `chatly:vr:<publicId>`, the same key the real loader reads', () => {
    const win = host();
    const mock = installChatlyMock(win, { publicId: PID });
    expect(mock.returningVisitor()).toBe(false);
    expect((win.Chatly as { hasSession?: () => boolean }).hasSession?.()).toBe(false);

    win.localStorage.map.set(`chatly:vr:${PID}`, '{}');
    // Still not loaded: the whole point is that a host in manual mode can ask
    // this to decide whether to load at all.
    expect(mock.state().ready).toBe(false);
    expect(mock.returningVisitor()).toBe(true);
  });

  it('seeds a returning visitor on request', () => {
    const win = host();
    const mock = installChatlyMock(win, { publicId: PID, returning: true });
    expect(mock.returningVisitor()).toBe(true);
    expect(win.localStorage.map.has(`chatly:vr:${PID}`)).toBe(true);
  });

  it('is false with no publicId rather than throwing', () => {
    const mock = installChatlyMock(host(), {});
    expect(mock.returningVisitor()).toBe(false);
  });
});

describe('an unknown method is REFUSED, not swallowed', () => {
  it('names the mistake', () => {
    const win = host();
    installChatlyMock(win, { publicId: PID, ready: true });
    /*
     * The real embed ignores it: the typo queues, replays, matches no method
     * and does nothing. No error and a label that never arrives. Reproducing
     * that silence faithfully would be reproducing the least useful thing
     * about it.
     */
    expect(() => (win.Chatly as (...a: unknown[]) => void)('setLable', 'vip')).toThrow(
      /not a method of the Chatly embed/,
    );
  });

  it('refuses it on REPLAY too, not only live', () => {
    const win = host();
    const mock = installChatlyMock(win, { publicId: PID });
    (win.Chatly as (...a: unknown[]) => void)('setLable', 'vip');
    // A typo made before the bundle loads is the common case — it is in the
    // snippet or in a mount effect — so the queue path has to refuse it too.
    expect(() => mock.load()).toThrow(/not a method/);
  });
});

describe('storage follows the embed’s storage mode', () => {
  it("writes nothing under 'deny'", () => {
    const win = host();
    const mock = installChatlyMock(win, { publicId: PID, ready: true });
    const chatly = win.Chatly as (...a: unknown[]) => void;
    chatly('init', { publicId: PID, storage: 'deny' });
    chatly('open');
    chatly('identify', { externalId: 'u_1', userHash: 'h' });
    expect([...win.localStorage.map.keys()]).toEqual([]);
    expect(mock.state().identity?.externalId).toBe('u_1');
  });

  it("withholds until the panel opens under 'on-open', the real default", () => {
    const win = host();
    installChatlyMock(win, { publicId: PID, ready: true });
    const chatly = win.Chatly as (...a: unknown[]) => void;
    chatly('init', { publicId: PID });
    chatly('identify', { externalId: 'u_1' });
    expect([...win.localStorage.map.keys()]).toEqual([]);

    chatly('open');
    chatly('identify', { externalId: 'u_1' });
    expect(win.localStorage.map.get(`chatly:xid:${PID}`)).toBe('u_1');
  });

  it("writes the session token and identity under 'allow'", () => {
    const win = host();
    installChatlyMock(win, { publicId: PID, ready: true });
    const chatly = win.Chatly as (...a: unknown[]) => void;
    chatly('init', { publicId: PID, storage: 'allow' });
    chatly('identify', { externalId: 'u_1', userHash: 'h_1' });
    expect([...win.localStorage.map.keys()].sort()).toEqual([
      `chatly:vh:${PID}`,
      `chatly:vt:${PID}`,
      `chatly:xid:${PID}`,
    ]);
  });

  it('reset() deletes the identity keys WHATEVER the storage mode', () => {
    /*
     * Withholding a write is a privacy choice; refusing to delete would be
     * the opposite of one. A sign-out must not leave the next visitor
     * identified as the last one.
     */
    const win = host();
    const mock = installChatlyMock(win, { publicId: PID, ready: true });
    const chatly = win.Chatly as (...a: unknown[]) => void;
    chatly('init', { publicId: PID, storage: 'allow' });
    chatly('identify', { externalId: 'u_1', userHash: 'h_1' });
    chatly('setStorageConsent', 'deny');
    chatly('reset');
    expect(win.localStorage.map.has(`chatly:xid:${PID}`)).toBe(false);
    expect(win.localStorage.map.has(`chatly:vh:${PID}`)).toBe(false);
    expect(mock.state().identity).toBeNull();
  });

  it('survives a store that throws on access', () => {
    // Blocked site data, or a sandboxed iframe's opaque origin. The widget
    // survives it and so must the kit — eleven unguarded reads once stopped
    // the widget booting at all.
    const win: HostWindow = {
      get localStorage(): StorageLike {
        throw new Error('SecurityError');
      },
    };
    const mock = installChatlyMock(win, { publicId: PID, ready: true });
    const chatly = win.Chatly as (...a: unknown[]) => void;
    expect(() => chatly('init', { publicId: PID, storage: 'allow' })).not.toThrow();
    expect(mock.returningVisitor()).toBe(false);
  });
});

describe('state the assertions read', () => {
  it('toggles, closes, and tracks the view', () => {
    const win = host();
    const mock = installChatlyMock(win, { publicId: PID, ready: true });
    const chatly = win.Chatly as (...a: unknown[]) => void;
    chatly('toggle');
    expectPanelOpen(mock);
    expect(mock.state().view).toBe('home');
    chatly('toggle');
    expectPanelClosed(mock);
    expect(mock.state().view).toBeNull();
    chatly('toggle', 'open');
    expectPanelOpen(mock);
    chatly('toggle', false);
    expectPanelClosed(mock);
  });

  it('startConversation opens on messages', () => {
    const win = host();
    const mock = installChatlyMock(win, { publicId: PID, ready: true });
    (win.Chatly as (...a: unknown[]) => void)('startConversation');
    expect(mock.state()).toMatchObject({ open: true, view: 'messages' });
  });

  it('records labels, attributes and events', () => {
    const win = host();
    const mock = installChatlyMock(win, { publicId: PID, ready: true });
    const chatly = win.Chatly as (...a: unknown[]) => void;
    chatly('setLabel', 'vip');
    chatly('setLabel', 'vip');
    chatly('setLabel', 'beta');
    chatly('removeLabel', 'vip');
    chatly('setCustomAttributes', { plan: 'pro' });
    chatly('deleteCustomAttribute', 'gone');
    chatly('setLocale', 'fr-FR');
    chatly('track', 'checkout', { total: 10 });
    expect(mock.state()).toMatchObject({
      labels: ['beta'],
      attributes: { plan: 'pro' },
      locale: 'fr-FR',
      tracked: [{ name: 'checkout', properties: { total: 10 } }],
    });
  });

  it('setUser folds its two arguments into one identity', () => {
    const win = host();
    const mock = installChatlyMock(win, { publicId: PID, ready: true });
    (win.Chatly as (...a: unknown[]) => void)('setUser', 'u_9', { email: 'a@b.test' });
    expect(mock.state().identity).toEqual({ externalId: 'u_9', email: 'a@b.test' });
  });

  it('destroy closes the panel and is reversible by init', () => {
    const win = host();
    const mock = installChatlyMock(win, { publicId: PID, ready: true });
    const chatly = win.Chatly as (...a: unknown[]) => void;
    chatly('open');
    chatly('destroy');
    expect(mock.state()).toMatchObject({ destroyed: true, open: false });
    chatly('init', { publicId: PID });
    expect(mock.state().destroyed).toBe(false);
  });

  it('records a call it does not model, rather than pretending to apply it', () => {
    const win = host();
    const mock = installChatlyMock(win, { publicId: PID, ready: true });
    (win.Chatly as (...a: unknown[]) => void)('setTheme', { primary: '#000' });
    expect(mock.callsTo('setTheme')).toHaveLength(1);
    expect(mock.callsTo('setTheme')[0]?.args).toEqual([{ primary: '#000' }]);
  });
});

describe('the failure messages', () => {
  it('expectPanelOpen explains the queue when the embed has not loaded', () => {
    /*
     * The most common confusion this kit will cause: a test calls `open()`,
     * forgets `load()`, and asserts. The message has to say so, because "the
     * panel is closed" sends the reader looking at their page.
     */
    const win = host();
    const mock = installChatlyMock(win, { publicId: PID });
    (win.Chatly as (...a: unknown[]) => void)('open');
    expect(() => expectPanelOpen(mock)).toThrow(/mock\.load\(\)/);
  });

  it('expectPanelClosed names the view and the calls', () => {
    const win = host();
    const mock = installChatlyMock(win, { publicId: PID, ready: true });
    (win.Chatly as (...a: unknown[]) => void)('open', 'help');
    expect(() => expectPanelClosed(mock)).toThrow(/"help".*open/s);
  });
});

describe('uninstall', () => {
  it('restores whatever was at window.Chatly', () => {
    const win: HostWindow = { localStorage: memoryStore() };
    const sentinel = { mine: true };
    win.Chatly = sentinel;
    const mock = installChatlyMock(win, { publicId: PID });
    expect(win.Chatly).not.toBe(sentinel);
    mock.uninstall();
    expect(win.Chatly).toBe(sentinel);
  });

  it('deletes the key when there was nothing there before', () => {
    const win = host();
    const mock = installChatlyMock(win, { publicId: PID });
    mock.uninstall();
    expect('Chatly' in win).toBe(false);
  });
});
