import { CONNECTED_APPS, connectionHref, isConnectedAppId } from './catalog';

export const APP_CONNECTION_TOOL_NAME = 'request_app_connection';
export const APP_CONNECTION_TOOLS = [{
  type: 'function',
  function: {
    name: APP_CONNECTION_TOOL_NAME,
    description: 'Show the user the connection screen for Gmail or Google Drive when they ask to connect an account or need an unavailable app. This only opens connection details; it does not access Google data or grant permissions. This preview has no working Google data tools yet.',
    parameters: {
      type: 'object',
      properties: { app: { type: 'string', enum: ['gmail', 'google-drive'] } },
      required: ['app'],
      additionalProperties: false,
    },
  },
}];

export function connectionToolResult(args: Record<string, unknown>): Record<string, unknown> {
  if (!isConnectedAppId(args.app)) return { status: 'invalid_app', message: 'Choose Gmail or Google Drive.' };
  const app = CONNECTED_APPS.find(item => item.id === args.app)!;
  return {
    status: 'setup_required',
    app: app.id,
    connected: false,
    connection_url: connectionHref(app.id),
    message: `The ${app.name} connection interface is available in this preview, but Google authorization and data actions are not enabled. Show [Connect ${app.name}](${connectionHref(app.id)}) to open the connection screen. Explain that setup is still needed. Do not claim to read, create, edit, send, or delete anything in Google.`,
  };
}

export function appConnectionInstruction(isOperator: boolean): string {
  return `GOOGLE APPS PREVIEW: Gmail and Google Drive connection screens are available, but Google account authorization and Google data/action tools are not enabled in this preview. Never claim an account is connected or an external action succeeded. ${isOperator ? 'You are the app operator. When the user asks to connect Gmail/Drive or requests work that requires them, call request_app_connection and present its connection link. You may still draft text in chat, clearly distinguishing it from a saved Gmail draft or Google Doc.' : 'ChatGPT is the app operator. You can discuss the user’s request, but cannot independently access connected apps. Do not claim to have searched Gmail/Drive. Refer to the connection option from ChatGPT if present.'} Do not discuss apps unless relevant to the user’s request.`;
}
