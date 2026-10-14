'use client';

type PickerData = { action: string; docs?: { id: string; name: string }[] };
type PickerBuilder = {
  setOAuthToken(token: string): PickerBuilder; setDeveloperKey(key: string): PickerBuilder;
  setAppId(id: string): PickerBuilder; setOrigin(origin: string): PickerBuilder;
  addView(view: unknown): PickerBuilder; setCallback(callback: (data: PickerData) => void): PickerBuilder;
  build(): { setVisible(visible: boolean): void };
};
type PickerWindow = Window & {
  gapi?: { load(name: string, options: { callback(): void; onerror(): void; timeout: number; ontimeout(): void }): void };
  google?: { picker?: { PickerBuilder: new () => PickerBuilder; DocsView: new (id: string) => { setMimeTypes(types: string): unknown }; ViewId: { DOCUMENTS: string }; Action: { PICKED: string; CANCEL: string } } };
};
let loading: Promise<void> | undefined;
function loadPicker(): Promise<void> {
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const win = window as PickerWindow;
    const ready = () => win.gapi?.load('picker', { callback: resolve, onerror: () => reject(new Error('Could not load Google’s file chooser.')), timeout: 15_000, ontimeout: () => reject(new Error('Google’s file chooser timed out.')) });
    if (win.gapi) { ready(); return; }
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.onload = ready;
    script.onerror = () => { script.remove(); reject(new Error('Could not load Google’s file chooser.')); };
    document.head.appendChild(script);
  }).catch(error => { loading = undefined; throw error; });
  return loading;
}
export async function chooseGoogleDocs(): Promise<{ id: string; name: string }[]> {
  const response = await fetch('/api/integrations/picker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store' });
  const config = await response.json();
  if (!response.ok) throw new Error(config.error || 'Could not open the file chooser.');
  await loadPicker();
  const picker = (window as PickerWindow).google?.picker;
  if (!picker) throw new Error('Google’s file chooser is unavailable.');
  return new Promise(resolve => {
    const view = new picker.DocsView(picker.ViewId.DOCUMENTS).setMimeTypes('application/vnd.google-apps.document');
    const chooser = new picker.PickerBuilder().setOAuthToken(config.accessToken).setDeveloperKey(config.developerKey)
      .setAppId(config.appId).setOrigin(window.location.origin).addView(view).setCallback(data => {
        if (data.action === picker.Action.PICKED) { chooser.setVisible(false); resolve((data.docs || []).filter(doc => /^[A-Za-z0-9_-]+$/.test(doc.id)).map(doc => ({ id: doc.id, name: doc.name }))); }
        else if (data.action === picker.Action.CANCEL) resolve([]);
      }).build();
    chooser.setVisible(true);
  });
}
