'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowUpRight, Check, LockKeyhole, Plug, X } from 'lucide-react';
import { CONNECTED_APPS, ConnectedAppId, isConnectedAppId } from '@/lib/integrations/catalog';

const OPEN_APPS_EVENT = 'plurilog:open-apps';

export function openConnectedApp(app?: ConnectedAppId) {
  window.dispatchEvent(new CustomEvent(OPEN_APPS_EVENT, { detail: { app } }));
}

export function AppConnectionButton({ app }: { app: ConnectedAppId }) {
  const details = CONNECTED_APPS.find(item => item.id === app)!;
  return (
    <button type="button" onClick={() => openConnectedApp(app)}
      className="my-1 inline-flex min-h-10 items-center gap-2.5 rounded-xl border border-[#D9D6CF] bg-white px-3.5 py-2 text-sm font-medium text-[#1C1B1A] hover:bg-[#F7F6F3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1C1B1A] cursor-pointer">
      <Image unoptimized src={details.logo} width={20} height={20} alt="" />
      Connect {details.name}
      <ArrowUpRight className="h-3.5 w-3.5 text-[#8A867D]" aria-hidden="true" />
    </button>
  );
}

export function AppsSidebarSection({ compact = false }: { compact?: boolean }) {
  if (compact) return (
    <button type="button" onClick={() => openConnectedApp()} aria-label="Apps" title="Apps"
      className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg text-[#6A675F] hover:bg-[#F4F3F0] cursor-pointer focus-visible:outline-2 focus-visible:outline-[#1C1B1A]">
      <Plug className="h-4 w-4" aria-hidden="true" />
    </button>
  );
  return (
    <section aria-label="Apps" className="shrink-0 border-t border-[#E2E0DB] px-2.5 pb-2 pt-3">
      <div className="px-2.5 pb-1.5 text-[10px] font-medium tracking-[0.12em] text-[#8A867D] uppercase">Apps</div>
      {CONNECTED_APPS.map(app => (
        <button key={app.id} type="button" onClick={() => openConnectedApp(app.id)} aria-label={`Connect ${app.name}`}
          className="group flex min-h-10 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left hover:bg-[#F4F3F0] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[#1C1B1A]">
          <Image unoptimized src={app.logo} width={19} height={19} alt="" className="shrink-0 object-contain" />
          <span className="flex-1 text-[13px] text-[#1C1B1A]">{app.name}</span>
          <span className="text-[11px] text-[#8A867D] group-hover:text-[#1C1B1A]">Connect</span>
        </button>
      ))}
      <button type="button" onClick={() => openConnectedApp()}
        className="mt-0.5 flex min-h-8 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-[12px] text-[#8A867D] hover:bg-[#F4F3F0] hover:text-[#1C1B1A] cursor-pointer focus-visible:outline-2 focus-visible:outline-[#1C1B1A]">
        <Plug className="h-[19px] w-[19px] p-0.5" aria-hidden="true" />More apps
      </button>
    </section>
  );
}

/** One host for sidebar, mobile rail, deep links, and model connection buttons. */
export function ConnectedAppsDialog() {
  const [selection, setSelection] = useState<ConnectedAppId | 'catalog' | null>(null);
  const [status, setStatus] = useState<'loading' | 'setup_required' | 'sign_in' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const app = CONNECTED_APPS.find(item => item.id === selection);
  const isOpen = selection !== null;
  const selectApp = (value: ConnectedAppId | 'catalog') => { setStatus('loading'); setSelection(value); };

  useEffect(() => {
    const open = (event: Event) => {
      const requested = (event as CustomEvent).detail?.app;
      setStatus('loading');
      setSelection(isConnectedAppId(requested) ? requested : 'catalog');
    };
    window.addEventListener(OPEN_APPS_EVENT, open);
    let cancelled = false;
    const url = new URL(window.location.href);
    const requested = url.searchParams.get('connectApp');
    if (isConnectedAppId(requested)) {
      queueMicrotask(() => { if (!cancelled) setSelection(requested); });
      url.searchParams.delete('connectApp');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
    return () => { cancelled = true; window.removeEventListener(OPEN_APPS_EVENT, open); };
  }, []);

  useEffect(() => {
    if (!selection) return;
    const controller = new AbortController();
    fetch('/api/integrations', { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (response.status === 401) { setStatus('sign_in'); return; }
        if (!response.ok) throw new Error('Unavailable');
        const result = await response.json();
        if (!Array.isArray(result.apps) || !result.apps.every((item: { status?: string }) => item.status === 'setup_required')) throw new Error('Unexpected status');
        setStatus('setup_required');
      })
      .catch(() => { if (!controller.signal.aborted) setStatus('error'); });
    return () => controller.abort();
  }, [selection, attempt]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen || !dialog) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog.showModal();
    closeRef.current?.focus();
    return () => {
      dialog.close();
      previousFocus?.focus();
    };
  }, [isOpen]);

  if (!selection) return null;
  return createPortal(
    <dialog ref={dialogRef} aria-labelledby="connected-apps-title" aria-describedby="connected-apps-description"
      onCancel={() => setSelection(null)}
      onClick={event => { if (event.target === dialogRef.current) { const rect = dialogRef.current.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setSelection(null); } }}
      className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-[460px] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[24px] border border-[#E2E0DB] bg-white p-0 text-[#1C1B1A] shadow-[0_24px_90px_rgba(28,27,26,0.18)] backdrop:bg-[rgba(28,27,26,0.28)] backdrop:backdrop-blur-[3px]">
      <div className="flex items-center justify-between px-5 pt-4">
        {app ? <button type="button" onClick={() => selectApp('catalog')} className="flex min-h-9 items-center gap-1.5 text-xs text-[#6A675F] hover:text-[#1C1B1A] cursor-pointer"><ArrowLeft className="h-3.5 w-3.5" />All apps</button> : <span className="text-[10px] uppercase tracking-[0.12em] text-[#8A867D]">Your workspace</span>}
        <button ref={closeRef} type="button" onClick={() => setSelection(null)} aria-label="Close apps" className="flex h-9 w-9 items-center justify-center rounded-full text-[#8A867D] hover:bg-[#F4F3F0] focus-visible:outline-2 focus-visible:outline-[#1C1B1A] cursor-pointer"><X className="h-4 w-4" /></button>
      </div>
      <div className="px-6 pb-6 pt-3 sm:px-7 sm:pb-7">
        {app ? <>
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-[#EAE8E3] bg-[#FAF9F7]"><Image unoptimized src={app.logo} width={36} height={36} alt="" /></div>
          <h2 id="connected-apps-title" className="text-[24px] font-medium tracking-[-0.035em]">Connect {app.name}</h2>
          <p id="connected-apps-description" className="mt-2 text-sm leading-6 text-[#6A675F]">{app.description}</p>
          <div className="mt-6">
            <p className="mb-3 text-xs font-medium text-[#8A867D]">Planned for this connection</p>
            <ul className="space-y-3">{app.capabilities.map(item => <li key={item} className="flex items-start gap-2.5 text-[13px] leading-5"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#8A867D]" aria-hidden="true" />{item}</li>)}</ul>
          </div>
          <div className="mt-6 rounded-xl border border-[#EAE8E3] bg-[#FAF9F7] p-3.5">
            <div className="flex items-start gap-2.5"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-[#8A867D]" /><p className="text-xs leading-5 text-[#6A675F]">You choose what to share. ChatGPT will handle app actions; content used in a discussion may also be shared with the other AIs you enable.</p></div>
          </div>
          <div role="status" aria-live="polite" className="mt-5 text-xs leading-5 text-[#8A867D]">
            {status === 'loading' ? 'Checking connection availability…' : status === 'error' ? 'Couldn’t check connection availability. Please try again.' : status === 'sign_in' ? 'Sign in to Plurilog to manage your apps.' : 'This is a preview of the connection experience. Google authorization and app actions are not enabled yet. No account has been connected.'}
          </div>
          {status === 'error' ? <button type="button" onClick={() => { setStatus('loading'); setAttempt(value => value + 1); }} className="mt-4 min-h-11 w-full rounded-xl bg-[#1C1B1A] text-sm font-medium text-white cursor-pointer">Try again</button> : <button type="button" disabled className="mt-4 min-h-11 w-full rounded-xl bg-[#F0EEEA] text-sm font-medium text-[#9B978E] disabled:cursor-not-allowed">{status === 'loading' ? 'Checking…' : 'Google connection coming soon'}</button>}
        </> : <>
          <h2 id="connected-apps-title" className="text-[26px] font-medium tracking-[-0.035em]">Your apps, in the conversation.</h2>
          <p id="connected-apps-description" className="mt-2 text-sm leading-6 text-[#6A675F]">Bring your email and documents into Plurilog. Choose an app to explore its connection.</p>
          <div className="mt-6 space-y-3">{CONNECTED_APPS.map(item => <button key={item.id} type="button" onClick={() => selectApp(item.id)} className="group flex w-full items-start gap-3.5 rounded-2xl border border-[#E2E0DB] p-4 text-left hover:bg-[#FAF9F7] focus-visible:outline-2 focus-visible:outline-[#1C1B1A] cursor-pointer"><Image unoptimized src={item.logo} width={28} height={28} alt="" className="mt-0.5" /><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{item.name}</span><span className="mt-1 block text-xs leading-5 text-[#8A867D]">{item.id === 'gmail' ? 'Email conversations and reply drafts' : 'Files and Google Docs'}</span></span><ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-[#8A867D]" /></button>)}</div>
          <p className="mt-5 text-xs leading-5 text-[#8A867D]">Gmail and Google Drive are first. More apps will follow.</p>
          <div className="mt-5 flex items-center gap-2 border-t border-[#EAE8E3] pt-4 text-xs text-[#8A867D]"><span className="h-1.5 w-1.5 rounded-full bg-[#C4B49B]" />Connection preview · Google access not yet enabled</div>
        </>}
      </div>
    </dialog>, document.body,
  );
}
