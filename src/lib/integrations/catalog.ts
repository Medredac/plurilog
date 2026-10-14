export const CONNECTED_APPS = [
  {
    id: 'gmail',
    name: 'Gmail',
    logo: '/apps/gmail.png',
    description: 'Bring the conversation from your inbox into Plurilog.',
    examples: ['Find Joe’s latest email', 'Help me draft a reply'],
    capabilities: ['Find and read email conversations', 'Prepare replies with the context of your discussion', 'Save replies as drafts in Gmail'],
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
