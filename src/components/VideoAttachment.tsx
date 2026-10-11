'use client';

import { useId, useRef } from 'react';
import { FileVideo, Play, X } from 'lucide-react';

/** Sent videos are labels; unsent videos can be previewed from their local blob. */
export function VideoAttachment({ filename, previewUrl }: { filename: string; previewUrl?: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const titleId = useId();
  const cardClass = 'flex min-h-[64px] w-[360px] max-w-full min-w-0 items-center gap-3 rounded-xl border border-[#E2E0DB] bg-[#F7F6F3] px-3 py-2.5 text-left';
  const contents = <>
    <FileVideo className="h-10 w-8 shrink-0 text-violet-600" aria-hidden="true" />
    <div className="min-w-0 flex-1">
      <p className="text-xs font-medium leading-5 text-[#1C1B1A] [overflow-wrap:anywhere]">{filename}</p>
      <p className="mt-0.5 text-[10px] leading-4 text-[#6A675F]">Video</p>
    </div>
    {previewUrl && <Play className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />}
  </>;

  return <>
    {previewUrl ? <button type="button" onClick={() => dialogRef.current?.showModal()}
      className={`${cardClass} cursor-pointer transition-colors hover:border-[#D9D6CF] hover:bg-[#EFEDE9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600`}
      aria-label={`Preview video ${filename}`}>{contents}</button>
      : <div className={cardClass}>{contents}</div>}
    {previewUrl && <dialog ref={dialogRef} aria-labelledby={titleId}
      onClose={() => videoRef.current?.pause()}
      onClick={event => { if (event.target === event.currentTarget) dialogRef.current?.close(); }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[min(900px,calc(100vw-2rem))] max-w-none overflow-auto rounded-2xl border border-stone-200 bg-white p-0 shadow-xl backdrop:bg-black/60">
      <div className="flex items-start gap-3 border-b border-stone-200 p-4">
        <h2 id={titleId} className="min-w-0 flex-1 text-sm font-medium [overflow-wrap:anywhere]">{filename}</h2>
        <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close video preview"
          className="shrink-0 rounded-md p-1 hover:bg-stone-100 focus-visible:outline-2"><X className="h-5 w-5" /></button>
      </div>
      <video ref={videoRef} src={previewUrl} controls playsInline preload="none" className="max-h-[70dvh] w-full bg-black">
        Your browser cannot play this video format.
      </video>
    </dialog>}
  </>;
}
