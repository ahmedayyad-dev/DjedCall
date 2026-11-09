# DjedCall — AI Constitution & Operating Rules

## Permanent Operating Rules
- **Document Durable Rules**: Whenever the user states a lasting rule, coding standard, or durable preference, record it here. Keep only rules that affect future development; never store transient notes or conversation history.
- **Rule Adherence**: Every rule in this file is binding across sessions. Re-read it at the start of a task and verify compliance before committing.
- **Intended Scope & Philosophy**: The application is designed exclusively for simple, trusted voice communication among friends, family, and collaborative work environments. It is not an open social network or intended for communicating with strangers.

## Open-Source Safety & Privacy (Absolute Requirement)
- **Zero Absolute Paths**: Never write home directories, local usernames, drive letters, or machine-specific paths in any git-tracked file. Every reference must be relative to the project root.
- **Zero Secrets**: Never commit credentials, tokens, API keys, session strings, private IDs, passwords, personal contact data, or IP addresses.
- **Zero Local Artifacts**: `.idea/`, `.venv/`, `node_modules/`, `.wrangler/`, `dist/`, logs, and OS files must never be committed.
- **Public by Default**: Treat every committed line as permanently public. Never commit internal notes, private URLs, or data about real users.

## Response Language
- Always respond to the user in Arabic.

## Git Policy
- **Local Commits Only**: Push, pull, fetch, clone, remote changes, rebase, and branch switching require an explicit request.
- **Atomic Commits**: Commit one self-contained logical change at a time, only after every verification gate passes.
- **No History Rewrites**: Never force-push, rewrite published history, or delete a branch without explicit approval.
- **Messages Describe Changes**: Commit messages describe the change, not the conversation.

## Absolute Prohibitions
- **Voice, Text, and Synced YouTube Media**: Synchronized YouTube playback (video and audio mode) is supported. No camera, screen sharing, file transfer, or recording.
- **No Backend**: No application server, database, or server-side storage. The app is static files on Cloudflare Pages; PeerJS is signaling only.
- **No Runtime Third-Party Requests**: Scripts, styles, fonts, and icons must be served from this repository, with YouTube Iframe API permitted for synchronized media.
- **No Runtime CDN Assets**: Any vendored library needs a pinned local copy and an SRI hash.
- **No Dynamic Code**: Never use `eval`, `new Function`, `document.write`, or dynamic script injection.
- **No Untrusted HTML**: Never pass untrusted data to `innerHTML`. Use `textContent` or `escapeHtml`.
- **No Weak Security Headers**: Never weaken the CSP or the other headers in `_headers`.
- **No Tracking**: Never add analytics, trackers, crash reporting, or advertising.

## Project Architecture
The project is a static site with no build step. The root contains:

- `index.html`: structure, inline SVG sprite, and static Arabic UI text.
- `css/style.css`: the full design system, including local fonts.
- `js/`: ES modules only.
- `vendor/`: pinned PeerJS plus its integrity hash.
- `fonts/`: Tajawal woff2 files and the OFL license.
- `_headers`, `_redirects`: Cloudflare Pages configuration.
- `README.md`, `AI_CONSTITUTION.md`, `LICENSE`.

Module boundaries:

- `config.js`: every constant (peer server, ICE, audio, limits).
- `strings.js`: every dynamic user-visible string.
- `guard.js`: sanitization, link blocking, and ID validation.
- `utils.js`: pure helpers and the `/{room}` route.
- `audio.js`: microphone, VAD, SDP and bitrate tuning, stats.
- `net.js`: media route classification.
- `ui.js`: DOM rendering only, never signaling.
- `rtc.js`: PeerJS, mesh, discovery gateway, and data channels.
- `youtube.js`: YouTube Iframe API, search, playback sync, and drift correction.
- `app.js`: wiring and initialization.

No circular imports. Imports at the top of each file only.

## Code Style & Standards
- Modern ES modules, 4-space indentation, single quotes, semicolons.
- No framework, bundler, transpiler, or runtime package manager.
- One import statement per module path; browser APIs before local modules.
- **Single Source of Truth**: Eliminate duplicated logic and duplicated text.
- **No Dead Code**: Remove unused exports, unused branches, and message types no peer sends.
- **Validate Every Payload**: Guard network input before use, and re-validate it on the receiving side.
- **Intentional Catches Only**: Catch an error only where there is a recovery or a deliberate ignore, and comment the fallback.
- Keep functions small and named for the effect they produce.

## User-Facing Text & UI
- Arabic RTL only.
- Static UI text lives only in `index.html`. Dynamic or state-dependent text lives only in `js/strings.js`. No visible string may be hardcoded anywhere else.
- The lobby document title comes from `index.html`; never duplicate it in JavaScript.
- **No Emojis**: Use textual symbols only (`▪`, `▫`, `═`, `✗`, `✓`, `➤`, `⇧`, `⇩`, `↻`, `↺`, `‹`, `›`, `■`, `✕`).
- Escape every network-sourced value before display, including names, messages, and history.
- Placeholders, `aria-label`s, and toasts follow the same rules.

## WebRTC & Audio
- Voice only: Opus at about 16kbps with DTX, mono, plus echo cancellation, noise suppression, and automatic gain control.
- Full mesh between participants. No admin role, no kick, and no moderation.
- The PeerJS server is configured only in `js/config.js`. If the host changes, update `connect-src` in `_headers` and the README in the same change.
- The committed PeerJS host is a public demo endpoint. It contains no credentials; forks should deploy their own server or change `PEER_SERVER` before production use.
- Default to STUN only. A local-network pair must stay host-to-host; participants outside the LAN use a direct srflx path, or a relay when TURN is configured. Mixed rooms must work.
- Show the real media route per participant: `local`, `direct`, or `relay`, derived from `getStats` on the selected candidate pair.
- The room route is `/{room}` only. The name never enters the URL; it is stored under `djedcall:name`.

## Security Model
- Re-validate every incoming name, message, timestamp, and peer ID. Never trust the sender.
- Reject oversized raw fields before cleaning (`RAW_NAME_MAX`, `RAW_TEXT_MAX`).
- Accept only room-scoped peer IDs that match `PEER_ID_PATTERN`.
- Rate-limit incoming chat and drop malformed payloads silently.
- Block links in names and messages at both ends.
- Escape all rendered output; never build HTML from untrusted strings without `escapeHtml`.
- Keep the SRI hash on `vendor/peerjs.min.js`.

## Verification Gates (before any commit)
1. `node --check` passes for every `js/*.js` file.
2. No emojis outside the allowed symbols.
3. No absolute paths, secrets, tokens, or IP addresses in tracked files.
4. No hardcoded user-visible strings outside `index.html` and `js/strings.js`.
5. Browser check: empty name rejected, deep link `/{room}` works, rename persists in `localStorage`, CSP console clean.
6. Route classification returns `local`, `direct`, and `relay` for the three candidate-pair shapes.
7. Real audio requires two real devices with microphone permission. A headless browser cannot verify `getUserMedia` or real ICE connectivity, so never claim audio was tested there.

## Documentation
- `README.md` is the public project document: usage, architecture, local run, deployment, security, limits, and license.
- Update the README in the same change as any behavior change.
- Never paste conversation notes or internal reasoning into the README.
- Record durable rules here; keep this file free of transient notes.

## Licensing
- **Code**: MIT, see `LICENSE`.
- **Font**: Tajawal under the SIL Open Font License, full text in `fonts/OFL.txt`.
- **Third-Party Components**: PeerJS, Lucide icons, and the font are documented in `THIRD_PARTY_NOTICES.md`.
- Any new dependency must have a compatible license, a pinned local copy when served at runtime, and an entry in `THIRD_PARTY_NOTICES.md` and the README.
