export const CONNECTED_APPS = [
  {
    id: 'gmail',
    name: 'Gmail',
    logo: '/apps/gmail.png',
    description: 'Bring the conversation from your inbox into Plurilog.',
    examples: ['Find Joe’s latest email', 'Help me draft a reply'],
    capabilities: ['Find and read email conversations', 'Prepare replies with the context of your discussion', 'Create, edit, and send email drafts when you ask', 'Reply and forward emails', 'Archive, label, mark read/unread, and move emails to Trash'],
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    logo: '/apps/google-drive.png',
    description: 'Work with your files and Google Docs without leaving the conversation.',
    examples: ['Summarize a Google Doc', 'Turn this discussion into a document'],
    capabilities: ['Read files you choose to share', 'Create and update Google Docs', 'Use your documents as context in a discussion'],
  },
] as const;

export type ConnectedAppId = (typeof CONNECTED_APPS)[number]['id'];
export function isConnectedAppId(value: unknown): value is ConnectedAppId {
  return value === 'gmail' || value === 'google-drive';
}

// These are UI destinations, never authorization endpoints. Opening a link
// cannot grant access, execute a Google operation, or change an account.
export function connectionHref(app: ConnectedAppId): string {
  return `/dashboard?connectApp=${app}`;
}

export function appFromConnectionHref(href: string | undefined): ConnectedAppId | null {
  if (!href) return null;
  const match = /^\/dashboard\?connectApp=(gmail|google-drive)$/.exec(href);
  return match ? match[1] as ConnectedAppId : null;
}

/** Only recognized provider destinations receive app branding. */
export function appDestination(href: string | undefined): { app: ConnectedAppId; label: string } | null {
  if (!href) return null;
  try {
    const url = new URL(href);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (url.hostname === 'mail.google.com' && /^\/mail(?:\/|$)/.test(url.pathname)) {
      return { app: 'gmail', label: url.hash.startsWith('#drafts') ? 'Open Gmail drafts' : url.hash.startsWith('#sent') ? 'View sent email' : url.hash.startsWith('#trash') ? 'Open Gmail Trash' : 'Open in Gmail' };
    }
    if (url.hostname === 'docs.google.com' && /^\/document\/d\/[A-Za-z0-9_-]+(?:\/|$)/.test(url.pathname)) return { app: 'google-drive', label: 'Open Google Doc' };
    return null;
  } catch { return null; }
}
