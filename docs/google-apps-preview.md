# Google Apps preview

Based on production commit `3f0acce8f47f0c8dfa77e8796b0e8c66ab2278e8`.

## Implemented in preview

- Gmail/Drive sidebar and shared connection dialog, live server-derived status, connect/disconnect, and Google Picker for selected Docs.
- Separate user-scoped Vercel Connect grants. Subjects include preview namespace, app ID and authenticated Supabase user ID. Google sign-in does not grant app access.
- ChatGPT-only Gmail search/count/read with pagination; draft listing, reading, creation, plain-text editing, sending, replies and text forwards; Cc/Bcc; archive/inbox, read/unread, star/unstar, Trash/restore, and label creation/renaming/application/removal. Selected Docs support list/read/create/append/replace and current-user image insertion.
- Substantive discussions retain all seats. ChatGPT can finish a fully completed routine app task with `finish_app_task`, suppressing redundant subsequent peer receipts. Failed/incomplete app sessions cannot use that completion path.
- Google reads are marked as untrusted data. No permanent deletion, mailbox settings, sharing, or arbitrary HTTP tools. Gmail bulk modifications require observed message IDs and allowlisted operations.
- Exact original reply recipient, MIME header validation, Docs revision and tab protection, current-user image ownership, bounded result sizes, durable per-user/run write deduplication, and stop-on-uncertain-write handling.
- Access tokens stay server-side except the short-lived `drive.file` token required by Google Picker. No tokens in model context, chat, logs, or browser persistence. Vercel Connect manages OAuth state, PKCE, token storage, refresh, and revocation.

**The original Gmail connection, count, and draft creation have been tested live. Expanded actions require renewed user consent and live acceptance.** Automated tests use simulated providers; they do not establish live delivery.

## Preview configuration

Use separate Gmail and Drive OAuth clients/connectors to isolate grants from production sign-in and from each other's revocation. The owner approved managed Connect pricing and terms. Created `google/plurilog-preview-gmail` and `google/plurilog-preview-drive` with separate Google web clients. Vercel project links permit Preview only; branch-scoped environment variables and a runtime branch check enable only `feat/google-apps-preview`. No end-user grants are created by administrator setup.

1. Create preview-only Google OAuth web clients in the existing `plurilog` Cloud project. Gmail, Drive and Docs APIs are enabled. Picker API is also enabled. Register the callback URL supplied by each Vercel connector (do not guess it).
2. Preserve the existing production sign-in client and Google project publishing status. Public Gmail rollout still requires restricted-scope verification and security-assessment planning. Gmail now requests `gmail.modify`, which covers reading, drafting, sending, labels, archive, and recoverable Trash operations. Existing read/compose-only grants must reconnect to approve this scope. Drive requests only `drive.file`, which covers files chosen with Picker or created by the application, not the whole Drive.
3. Create distinct Vercel user OAuth connectors using those clients and link only to this project's Preview environment, with branch enablement enforced in code and environment variables. Retain their actual returned UIDs; do not invent connector IDs. Store client secrets directly in the managed connector, never source/chat.
4. Set the following branch-scoped Preview environment variables:
   - `GOOGLE_APPS_ENABLED=true`
   - `GOOGLE_APPS_ORIGIN=https://plurilog-git-feat-google-apps-preview-reda-projects94.vercel.app`
   - `GOOGLE_GMAIL_CONNECTOR=google/plurilog-preview-gmail`
   - `GOOGLE_DRIVE_CONNECTOR=google/plurilog-preview-drive`
   - `GOOGLE_CLOUD_PROJECT_NUMBER=643518377410`
   - `GOOGLE_PICKER_API_KEY=<browser key restricted to the stable preview origin and Google Picker API>`
   - `GOOGLE_APPS_ENCRYPTION_KEY=<32 random bytes as hex, for encrypted action receipts only>`
5. Redeploy preview. The origin restriction intentionally requires the stable branch URL for connection/disconnection/Picker POST requests. Production is hard-disabled in this version.

The additive migration creates server-only preview tables in the existing database. Only `preview_google_action_receipts` is used by this managed implementation; `preview_google_connections` and `preview_google_oauth_states` remain empty and unused. OAuth credentials live in Vercel Connect, not Supabase. Existing application tables/policies and production deployment settings are unchanged. RLS is enabled with no public access; the advisor informational no-policy notices are intentional for these service-role-only tables.

## Verification

Automated: `node --test tests/app-connections.test.cjs tests/google-integrations.test.cjs tests/panel-contribution-prompts.test.cjs`, TypeScript, and focused lint.

Live acceptance still required: authorize Gmail/Drive; deny consent; reconnect/disconnect; choose a Doc; search/read an explicitly identified test email; create one draft and inspect it in Gmail; create and edit a disposable Doc; insert an uploaded image; verify stale revision conflict; verify another Plurilog account cannot access the first account's grants. Use the user’s explicit permission for accessing test data.

## Limits of this v1

- Plain-text draft authoring and Docs edits; no new email attachments, permanent deletion, spreadsheet or slide tools. Text forwards exclude attachments. Existing rich-text/attachment drafts can be read/sent unchanged but edits are directed to Gmail to preserve their contents.
- File chooser is for native Google Docs. Search only covers files selected for or created by the app.
- Durable receipts are keyed by authenticated user, debate run and action fingerprint; encrypted results allow safe replay within the same run. Pending/unknown actions are never automatically repeated. A new run with a new request can still create a new draft. Sends use a reserved UUID receipt namespace and a user/draft fingerprint across runs; a current explicit send request and a fresh matching draft revision are required. There is no atomic transaction spanning Google and Supabase; an uncertain result requires inspecting Google.
- A tool session reuses one credential request per provider, while new sessions revalidate with Connect. Already-running operations may finish after disconnect. Status refreshes and Picker openings also retrieve credentials and can contribute to Connect usage. No background polling or webhook triggers are configured.
- If Doc creation succeeds but initial text insertion fails, report the existing document URL and read it before repairing it. Do not recreate.
- Image transfer uses a five-minute signed URL for an owned PNG/JPEG/GIF upload, fetched by Google. It never accepts a model-supplied external URL.
- Public rollout requires Google scope verification planning and a separate production configuration review.

## Expanded preview checks

- Branded, accessible Gmail/Docs links use exact HTTPS provider host/path checks; lookalike and credential-bearing URLs remain ordinary links.
- A send reads the draft again before calling Google; a changed revision stops the action. Google does not offer an atomic revision-conditional draft send, so a tiny external-edit race remains.
- Never automatically retry an uncertain send; inspect Sent first. No real send or mailbox modification is performed as a development test without the user authorizing the specific test.
