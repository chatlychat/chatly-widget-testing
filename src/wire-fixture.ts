/**
 * What `api.chatlychat.com` answers, restated — and kept honest by
 * `wire-parity.spec.ts`.
 *
 * ═══ WHY A RESTATED FIXTURE IS DANGEROUS, AND WHAT MAKES IT SAFE ══════════
 *
 * A fixture that invents a shape the server does not send makes the suite
 * agree with the bug. This repository has paid for that class twice over: two
 * SDKs shipped a paginator over a bare-array route with green suites, and
 * `dist-smoke-stub.mjs` answered `init` with `features: {}` — which the
 * widget read as `features.attachments.maxSizeBytes` and died on, in the
 * minified bundle only, long after every unit test was green.
 *
 * That stub's fix was to stop hand-writing the block and derive it from
 * `parseWidgetFeatureConfig` instead. **This file cannot do that.**
 * `@livechat/shared` is a private monorepo package, and a runtime import of
 * it from a package an integrator installs typechecks, passes every test and
 * breaks at install.
 *
 * So the shapes are restated, and `wire-parity.spec.ts` reads the real zod
 * schemas off disk — `apps/api/src/modules/widget/widget-response-schemas.ts`
 * and `…/widget-conversation-response-schemas.ts` for the envelopes, and
 * `packages/shared/src/widget-config/index.ts` for the feature block — and
 * fails Chatly's own build when a key appears on one side and not the other.
 * That is the same mechanism `storage-keys.ts` and `surface.ts` rely on, for
 * the same reason, and it is the only thing that makes a restated copy a fact
 * rather than one more drifting fake.
 *
 * ═══ WHAT IS DELIBERATELY NOT MODELLED ═══════════════════════════════════
 *
 * No state. `init` twice answers the same session; a posted message does not
 * appear in a later `messages/list`. The fixture exists so the real bundle
 * BOOTS and the four CHT-D09 assertions are reachable — nothing loaded before
 * click, one click opens, a returning chatter preloads, a signed-out visitor
 * resets. A stateful stand-in for the conversation engine would be a second
 * implementation of the product, and the moment it diverged it would be
 * teaching integrators something false. Anything beyond boot goes through
 * `respond`, where the caller owns the answer and knows they do.
 */

/**
 * `parseWidgetFeatureConfig({})`, restated.
 *
 * Measured from the real function rather than read off the schema source, so
 * the VALUES are the shipped defaults and not a guess at them. The keys are
 * what `wire-parity.spec.ts` pins; the values are what makes the bundle boot.
 *
 * The one thing to know before editing: every key here is read by name
 * somewhere in `apps/widget/src`, and a missing nested key is a crash in the
 * minified bundle rather than a type error — which is exactly how the
 * `features: {}` bug reached a real browser.
 */
export const WIDGET_FEATURE_DEFAULTS = {
  preChat: {
    enabled: true,
    whenOfflineOnly: true,
    askAfterFirstMessage: true,
    intro: 'Tell us how to reach you.',
    fields: [
      {
        key: 'name',
        label: 'Your name',
        type: 'text',
        required: false,
        placeholder: 'Ada Lovelace',
      },
      {
        key: 'email',
        label: 'Your email',
        type: 'email',
        required: true,
        placeholder: 'you@company.com',
      },
    ],
  },
  offline: {
    enabled: true,
    headline: 'We’re away right now',
    message: 'Leave a message and we’ll reply by email as soon as we’re back.',
    acceptMessages: true,
  },
  csat: { enabled: false, prompt: 'How did we do?', askComment: true },
  attachments: { enabled: true, maxSizeBytes: 10 * 1024 * 1024 },
  soundOnReply: true,
  emailTranscript: true,
  voiceNotes: false,
  gifs: { enabled: false, contentFilter: 'high' },
  reactions: true,
  voiceCalls: false,
  videoCalls: false,
  dictation: false,
} as const;

/** The six quick reactions the server offers when reactions are on. */
export const WIDGET_QUICK_REACTIONS = ['👍', '❤️', '🎉', '😄', '🙏', '👀'] as const;

/**
 * UUID v7-shaped ids, fixed rather than generated.
 *
 * Every id the visitor routes carry goes through `uuidV7Schema` server-side,
 * so a `conv_1` would be refused by the real API and a fixture that accepted
 * it would be teaching an integrator an id shape that does not exist. Fixed
 * so a failure message is the same on every run.
 */
export const WIRE_IDS = {
  workspace: '0190aaaa-0000-7000-8000-000000000001',
  brand: '0190aaaa-0000-7000-8000-000000000002',
  channel: '0190aaaa-0000-7000-8000-000000000003',
  contact: '0190aaaa-0000-7000-8000-000000000004',
  conversation: '0190aaaa-0000-7000-8000-000000000005',
  message: '0190aaaa-0000-7000-8000-00000000a000',
} as const;

/**
 * The nth message id, built rather than suffixed.
 *
 * `${WIRE_IDS.message}-${n}` and `…a000${n}` both look fine for n < 10 and
 * then produce a node of the wrong LENGTH, which `uuidV7Schema` refuses — so
 * a fixture that grew its own ids that way would serve a thread the real API
 * could not have served, and only for the caller who asked for eleven
 * replies.
 */
export function wireMessageId(n: number): string {
  return `0190aaaa-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
}

/** The identity a page asserted, as the fixture reflects it back. */
export interface WireIdentity {
  readonly externalId?: string;
  readonly email?: string;
  readonly name?: string;
  /** Present means the session comes back `identityVerified: true`. */
  readonly userHash?: string;
}

export interface ChatlyWireOptions {
  /** Whether anyone is available. Drives the away banner. */
  readonly online?: boolean;
  /** Reflected into the session, as a `identify()` would have left it. */
  readonly identity?: WireIdentity;
  /**
   * How many unseen agent replies the visitor's one thread holds.
   *
   * The fixture hands the widget this many agent messages newer than the
   * visitor's own. What the launcher BADGES is the widget's own derivation
   * (`apps/widget/src/widget/unread.ts` counts what the visitor can see
   * against the `chatly:vr:` watermark; it deliberately does not trust the
   * server's `unreadContactCount`), so this seeds the input and asserts
   * nothing about the output.
   *
   * Any value above zero also makes the session a RETURNING contact —
   * `contactId` non-null — because the real server answers `contactId: null`
   * for a visitor who has never spoken, and for that visitor the widget's
   * unread module does not run at all.
   */
  readonly unread?: number;
  readonly workspaceName?: string;
  /** Merged over the channel theme the fixture serves. */
  readonly branding?: Readonly<Record<string, unknown>>;
  /** Merged over `WIDGET_FEATURE_DEFAULTS`, one top-level key at a time. */
  readonly features?: Readonly<Record<string, unknown>>;
  /** Operator-set widget wording, the lowest of the widget's four layers. */
  readonly copy?: Readonly<Record<string, string>>;
  /**
   * Where the socket lives. `null` — the default — is what a channel with no
   * realtime configured answers, and the widget then falls back to polling.
   * That is the right default for a fixture: a route interceptor cannot serve
   * a websocket, so a url here would produce a connection that fails rather
   * than a thread that works.
   */
  readonly realtimeUrl?: string | null;
}

/** An answer for one path: the status and the JSON body. */
export interface WireResponse {
  readonly status: number;
  readonly body: unknown;
}

const ISO = (minutesAgo: number): string =>
  new Date(Date.UTC(2026, 9, 24, 12, 0, 0) - minutesAgo * 60_000).toISOString();

function identified(options: ChatlyWireOptions): boolean {
  return options.identity !== undefined || (options.unread ?? 0) > 0;
}

/** `POST /v1/widget/init` — everything the bundle needs to render. */
export function chatlyInitResponse(options: ChatlyWireOptions = {}): unknown {
  const identity = options.identity;
  /*
   * `Record<string, unknown>` and not the inferred literal: an override
   * merged over a frozen literal type widens every key it touches, and the
   * read below has to be about the VALUE rather than about what TypeScript
   * still believes the default was.
   */
  const features: Record<string, unknown> = {
    ...WIDGET_FEATURE_DEFAULTS,
    ...(options.features ?? {}),
  };
  return {
    session: {
      token: 'vs1.widget-testing.fixture',
      visitorKey: identity?.externalId ?? 'wt_anonymous_visitor',
      identityVerified: identity?.userHash !== undefined,
      contactId: identified(options) ? WIRE_IDS.contact : null,
      hasReplyAddress: true,
      deviceHash: null,
      workspaceId: WIRE_IDS.workspace,
      brandId: WIRE_IDS.brand,
      channelId: WIRE_IDS.channel,
    },
    workspace: { id: WIRE_IDS.workspace, name: options.workspaceName ?? 'Widget Testing' },
    branding: { primaryColor: '#2f6fed', ...(options.branding ?? {}) },
    features,
    online: options.online ?? true,
    behavior: {},
    copy: { ...(options.copy ?? {}) },
    profiles: [],
    realtimeUrl: options.realtimeUrl ?? null,
    // `!== false` rather than `=== true`: the key is `unknown` once an
    // override may have replaced it, and the server offers the bar unless
    // reactions are actually off.
    quickReactions: features['reactions'] !== false ? [...WIDGET_QUICK_REACTIONS] : [],
  };
}

/** `POST /v1/widget/conversations/list` — the seven-column projection. */
export function chatlyConversationListResponse(options: ChatlyWireOptions = {}): unknown {
  if (!identified(options)) {
    // What the server answers a visitor with no contact: an empty list, not
    // an error. An SDK that reads this as a failure state is wrong.
    return { conversations: [] };
  }
  const unread = Math.max(0, options.unread ?? 0);
  return {
    conversations: [
      {
        id: WIRE_IDS.conversation,
        status: 'open',
        subject: null,
        lastMessagePreview: unread > 0 ? 'a reply from the fixture' : 'hello',
        lastMessageAt: ISO(unread > 0 ? 1 : 30),
        unreadContactCount: unread,
        createdAt: ISO(60),
      },
    ],
  };
}

/** `POST /v1/widget/messages/list` — the nine-column visitor projection. */
export function chatlyMessageListResponse(options: ChatlyWireOptions = {}): unknown {
  if (!identified(options)) {
    return { messages: [] };
  }
  const unread = Math.max(0, options.unread ?? 0);
  const messages: unknown[] = [
    {
      id: wireMessageId(0xa000),
      authorType: 'contact',
      kind: 'text',
      body: 'hello',
      blocks: null,
      canvas: null,
      attachments: [],
      createdAt: ISO(30),
      deletedAt: null,
      reactions: [],
    },
  ];
  for (let i = 0; i < unread; i += 1) {
    messages.push({
      /*
       * A REAL v7-shaped id per reply, not an index suffix on a shared one:
       * the widget anchors its polling cursor on the newest id it has seen
       * and refuses a `local-` or malformed one, so duplicated ids would make
       * the thread look like it never advanced.
       */
      id: wireMessageId(0xa001 + i),
      authorType: 'agent',
      kind: 'text',
      body: `a reply from the fixture (${String(i + 1)})`,
      blocks: null,
      canvas: null,
      attachments: [],
      createdAt: ISO(unread - i),
      deletedAt: null,
      reactions: [],
    });
  }
  return { messages };
}

/**
 * The answer for one `/v1/widget/*` path, or `null` for "not modelled".
 *
 * The caller decides what `null` means. `installChatlyEmbed` answers it with
 * `{ ok: true }` and a 200 — the same choice `dist-smoke-stub.mjs` makes, and
 * for the same reason: the widget fires a dozen small acknowledged POSTs
 * (`events`, `read`, `dismiss`, `csat`, `profile`) whose bodies it does not
 * read, and failing them would turn a fixture into a source of console
 * errors that look like widget bugs.
 */
export function chatlyWireResponse(
  path: string,
  options: ChatlyWireOptions = {},
): WireResponse | null {
  switch (path) {
    case '/v1/widget/init':
      return { status: 200, body: chatlyInitResponse(options) };
    case '/v1/widget/conversations/list':
      return { status: 200, body: chatlyConversationListResponse(options) };
    case '/v1/widget/messages/list':
      return { status: 200, body: chatlyMessageListResponse(options) };
    case '/v1/widget/conversations':
      return {
        status: 200,
        body: {
          conversation: { id: WIRE_IDS.conversation, status: 'open' },
          message: {
            id: WIRE_IDS.message,
            conversationId: WIRE_IDS.conversation,
            authorType: 'contact',
            kind: 'text',
            body: 'hello',
            attachments: [],
            createdAt: ISO(0),
          },
        },
      };
    case '/v1/widget/realtime/token':
      /*
       * A plainly unusable token, on purpose. A route interceptor cannot
       * serve a websocket, so the socket is going to fail whatever this says;
       * what the fixture must not do is look like it might work. The widget
       * falls back to polling, which is the path these assertions run on.
       */
      return {
        status: 200,
        body: { token: 'vs1.widget-testing.no-socket', expiresAt: ISO(-60) },
      };
    case '/v1/widget/events':
      return { status: 200, body: { tracked: true } };
    case '/v1/widget/profile':
      /*
       * `reason: 'anonymous'` is present ONLY when nothing was applied. The
       * real route answers a 200 either way and the widget holds the values
       * and retries on the reason — so sending both fields together would
       * make a client that reads `reason` retry for ever.
       */
      return {
        status: 200,
        body: identified(options) ? { applied: true } : { applied: false, reason: 'anonymous' },
      };
    case '/v1/widget/transcript':
      return { status: 200, body: { queued: true } };
    default:
      return null;
  }
}
