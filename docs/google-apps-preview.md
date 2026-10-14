# Google Apps preview

Based on production commit `3f0acce8f47f0c8dfa77e8796b0e8c66ab2278e8`.

## Included

- Gmail and Google Drive rows, with official Google-hosted product logos stored locally, fixed below discussions and above the account menu.
- One accessible native dialog shared by desktop, mobile drawer/rail, the app catalog, and chat connection buttons.
- Authenticated, uncached connection availability endpoint. No connection is inferred from Google sign-in or local storage.
- ChatGPT-only `request_app_connection` tool in the existing bounded tool loop. It returns an allowlisted UI link, never an OAuth endpoint or external action.
- A clear preview state: Google authorization and account actions are not enabled. No pretend account, inbox, documents, or success state.

## Next implementation stage

This commit is an interface and orchestration preview, **not a functional Google connector**. Setting environment variables alone will not turn it into one.

1. Select a Google Cloud project (the existing sign-in project can be used), enable Gmail, Drive, and Docs APIs, and create a web OAuth client for integrations.
2. Implement authorization-code exchange with state, PKCE, user binding, exact callback allowlisting, and granular scope checks. Register the stable preview callback after it exists. Keep sign-in separate.
3. Add server-only encrypted token storage, refresh, revocation, ownership checks, and account status. Provision preview secrets directly in Vercel; never paste them into chat or commit them.
4. Implement Drive Picker and `drive.file` scope for selected documents. Do not imply this grants whole-Drive search. Implement Docs read/create/edit with revision checks and image transfer.
5. Implement Gmail search/read/draft tools. Decide send/trash confirmation behavior and enforce it server-side with exact-action binding and duplicate protection before exposing those actions.
6. Test two-account isolation, denied/revoked consent, expired tokens, retries, and real Google actions before showing Connected. Gmail restricted scopes require Google's verification/security review planning for public release.

Do not merge this preview into production until the intended release scope is agreed.
