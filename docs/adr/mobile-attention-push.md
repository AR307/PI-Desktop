# ADR: Session attention notifications for the Android companion

- Date: 2026-10-14
- Status: Accepted by the implementation request
- Related: `mobile-companion-relay.md`, `mobile-account-sync-offline-history.md`,
  `docs/spec/03-runtime/23-mobile-companion.md`

## Context

People share sessions with the phone to follow long tasks away from the desk.
The phone learned that a shared session needed an approval or an answer, or
that a task had finished or failed, only by opening that conversation.
`directoryChanged` notifications carried no detail and made the phone re-list
the whole directory. Nothing reached a phone that was in the background.

There is no push path today. MC forwards opaque RACP frames to online sockets
only, the companion has no FCM project, and the relay client lives in the
WebView. Many target devices ship without Google Play services.

## Decision

1. **Desktop activity frames.** The desktop sends the RACP notification
   `mobile.sessionActivity` with one refreshed `MobileSession` row and an
   optional `MobileAttention` (`approval`, `input`, `completed`, `failed`,
   `resolved`). It derives them from Agent Host events through a new
   `AgentHostOptions.onEvent` observer, and from direct image job outcomes.
   Delegate (`parentToolCallId`) turns are excluded. A completion is not sent
   while the session still has a pending approval or question, because that
   notification already went out. `resolved` follows the last answered request.
   Titles and previews are capped at `MOBILE_ATTENTION_TEXT_LIMIT` (160).
2. **Opt-in compatibility.** The phone requests the frames with
   `directory/subscribe { activity: true }`. The desktop advertises
   `sessionActivity: true` in `connection/initialize`. Older phones never
   receive the new frames. A new phone against an older desktop keeps the
   previous re-list behavior.
3. **Scope.** The broadcaster rechecks each peer's current scope for every
   frame, as transcript events already do. Unshared sessions never leave the
   desktop, and revocation stops delivery immediately. Updates for one session
   are coalesced for 250 ms and its row is described once per flush.
4. **Phone inbox and presentation.** `AttentionCenter` deduplicates by
   attention id and stores the inbox in the IndexedDB `attention` store
   (database version 3, account-scoped). The existing logout and revocation
   cleanup clears it. Where the attention appears depends on the phone:
   - Viewing that conversation: the item is marked read.
   - Visible elsewhere: an in-app toast and an Activity badge.
   - In the background: a system notification tagged by session, so each
     session has at most one.

   Opening the session or receiving `resolved` withdraws the notification.
   Text is localized on the phone. The lock screen shows only a public version.
5. **Delivery without server push.** While the app is in the background, the
   foreground service `RelayKeepAliveService` keeps the process and the WebView
   relay alive. Its type is `remoteMessaging` on API 34+ and `dataSync` on
   API 29–33. The service starts from `handleOnStop`, while the app still
   qualifies for a foreground-service start, and stops on resume. Keep-alive
   has three modes:
   - Smart (the default): keep alive while any task on an online computer is
     running, queued, waiting for the user or generating images, and for
     two minutes after the last one ends.
   - Always.
   - Off.

   Notifications use three channels: `pi.attention` (high), `pi.results`
   (default) and `pi.background` (minimum, for the ongoing notification).
   Notification permission is requested from settings or the Activity banner,
   never at launch.
6. **No MC change.** The frames are ordinary RACP notifications that MC
   forwards opaquely.

## Consequences

- Notifications arrive only while the app process lives. After a swipe-away or
  a force stop, or when the OEM kills background apps, delivery stops until the
  next launch. Settings link to the system's battery and app-detail pages.
- In Smart mode, work started on the desktop after keep-alive has lapsed is
  seen on the next open. Always mode covers this at a battery cost.
- Android requires an ongoing notification while the service runs.
- The phone receives a preview of up to 160 characters of the final reply or
  error. The preview comes from a session already shared with that phone, so
  nothing new is exposed. The public lock-screen version hides it.
- The Activity inbox is local to each phone and is not synchronized.

## Alternatives

- **FCM or MC-stored push.** This would need MC server work and Google Play
  services, and it would hold push tokens and content off the device.
  It is deferred. `MobileAttention` is self-contained so that a later server
  push can carry the same object.
- **A native relay client in the service.** This would duplicate the RACP
  client, ticket refresh and scope handling outside the WebView. Rejected.
- **Background polling.** It still needs a live process and wakes the radio
  on a timer. Rejected.
