# Google Apps preview

Based on production commit `3f0acce8f47f0c8dfa77e8796b0e8c66ab2278e8`.

## Implemented, pending live configuration and acceptance testing

- Gmail/Drive sidebar and shared connection dialog, live server-derived status, connect/disconnect, and Google Picker for selected Docs.
- Separate user-scoped Vercel Connect grants. Subjects include preview namespace, app ID and authenticated Supabase user ID. Google sign-in does not grant app access.
- ChatGPT-only search/read Gmail, save unsent plain-text reply drafts, list selected Docs, read/create/append/replace Docs, and insert a current user-uploaded image.
- Existing three-seat conversation remains intact. Other seats can discuss the operator's reported results, but cannot execute app tools.
- Google reads are marked as untrusted data. No send, trash, permanent delete, sharing or arbitrary HTTP/batch tools.
- Exact original reply recipient, MIME header validation, Docs revision and tab protection, current-user image ownership, bounded result sizes, per-turn write deduplication, and stop-on-uncertain-write handling.
- Access tokens stay server-side except the short-lived `drive.file` token required by Google Picker. No tokens in model context, chat, logs, or browser persistence. Vercel Connect manages OAuth state, PKCE, token storage, refresh, and revocation.

**Not ready for live testing until the setup below is completed.** Do not infer success from passing simulated-provider tests.

## Preview configuration

Use separate Gmail and Drive OAuth clients/connectors to isolate grants from production sign-in and from each other's revocation. Creation of the managed connectors was blocked by automatic approval review; specific user approval is pending. No connectors or grants have been created by this implementation.

1. Create preview-only Google OAuth web clients in the existing `plurilog` Cloud project. Gmail, Drive and Docs APIs are enabled. Enable Picker API for the file chooser. Register the callback URL supplied by each Vercel connector (do not guess it).
2. Configure Google consent and test users. Gmail requires `gmail.readonly` and `gmail.compose`. Google describes compose as permission to manage drafts **and send email**, although this application exposes no send operation. Drive requests only `drive.file`, which covers files chosen with Picker or created by the application, not the whole Drive.
3. Create distinct Vercel user OAuth connectors using those clients and link only to this project's `feat/google-apps-preview` preview branch. Retain their actual returned UIDs; do not invent connector IDs. Store client secrets directly in the managed connector, never source/chat.
4. Set the following branch-scoped Preview environment variables:
   - `GOOGLE_APPS_ENABLED=true`
   - `GOOGLE_APPS_ORIGIN=https://plurilog-git-feat-google-apps-preview-reda-projects94.vercel.app`
   - `GOOGLE_GMAIL_CONNECTOR=<actual returned UID>`
   - `GOOGLE_DRIVE_CONNECTOR=<actual returned UID>`
   - `GOOGLE_CLOUD_PROJECT_NUMBER=643518377410`
   - `GOOGLE_PICKER_API_KEY=<browser key restricted to the stable preview origin and Google Picker API>`
5. Redeploy preview. The origin restriction intentionally requires the stable branch URL for connection/disconnection/Picker POST requests. Production is hard-disabled in this version.

No database migrations or production settings are changed.

## Verification

Automated: `node --test tests/app-connections.test.cjs tests/google-integrations.test.cjs tests/panel-contribution-prompts.test.cjs`, TypeScript, and focused lint.

Live acceptance still required: authorize Gmail/Drive; deny consent; reconnect/disconnect; choose a Doc; search/read an explicitly identified test email; create one draft and inspect it in Gmail; create and edit a disposable Doc; insert an uploaded image; verify stale revision conflict; verify another Plurilog account cannot access the first account's grants. Use the user’s explicit permission for accessing test data.

## Limits of this v1

- Plain-text drafts and Docs edits; no email attachments, send/delete, spreadsheet or slide tools.
- File chooser is for native Google Docs. Search only covers files selected for or created by the app.
- Duplicate write suppression is per active turn, not a durable cross-request transaction. An uncertain mutation blocks further writes in that turn and asks the user to inspect Google. Do not add automatic mutation retries. Durable receipts are required before adding send/delete or unattended operations.
- If Doc creation succeeds but initial text insertion fails, report the existing document URL and read it before repairing it. Do not recreate.
- Image transfer uses a five-minute signed URL for an owned PNG/JPEG/GIF upload, fetched by Google. It never accepts a model-supplied external URL.
- Public rollout requires Google scope verification planning and a separate production configuration review.
