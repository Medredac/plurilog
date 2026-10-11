'use client';

import React, { useState, useRef, useCallback } from 'react';
import { ArrowUp, Plus, X, Square, FileText, Mic, Video } from 'lucide-react';
import { UploadFileDrawer } from './UploadFileDrawer';
import { ImageLightbox } from './ImageLightbox';
import { VoiceRecorder } from './VoiceRecorder';
import { AiSeatsControl } from './AiSeatsControl';
import { AiSeatsCoachmark } from './AiSeatsCoachmark';
import { ModelId } from '../types/chat';
import { COUNCIL_MEMBERS } from '../data/mockDebates';
import { isTextFileName, getTextFileDisplayBadge } from '@/utils/textFileParser';
import { VIDEO_LIMIT_BYTES, VIDEO_LIMIT_SECONDS, videoMime } from '@/utils/videoUpload';

interface ChatInputProps {
  onSendMessage: (content: string, files?: File[]) => void;
  isLoading?: boolean;
  isLocked?: boolean;
  onStop?: () => void;
  isCentered?: boolean;
  autoFocus?: boolean;
  focusTrigger?: any;
  restoreDraft?: { text: string; files?: File[]; trigger: number } | null;
  seatOrder: ModelId[];
  activeModels: ModelId[];
  onReorderSeats: (newOrder: ModelId[]) => void;
  onToggleModel: (id: ModelId) => void;
  showAiSeatsHint?: boolean;
  onDismissAiSeatsHint?: () => void;
  onRestoreDraftConsumed?: () => void;
}

interface AttachedFileItem {
  id: string;
  file: File;
  previewUrl: string;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  isLoading = false,
  isLocked = false,
  onStop,
  isCentered = false,
  autoFocus = false,
  focusTrigger,
  restoreDraft,
  seatOrder,
  activeModels,
  onReorderSeats,
  onToggleModel,
  showAiSeatsHint = false,
  onDismissAiSeatsHint,
  onRestoreDraftConsumed,
}) => {
  const [inputVal, setInputVal] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFileItem[]>([]);
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);
  const [isUploadDrawerOpen, setIsUploadDrawerOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Automatically focus textarea on mount, empty state, or when switching discussions
  React.useEffect(() => {
    const timer = setTimeout(() => {
      textareaRef.current?.focus({ preventScroll: true });
    }, 50);
    return () => clearTimeout(timer);
  }, [isCentered, autoFocus, focusTrigger]);

  // Restore draft prompt text & attachments when requested (e.g. pre-debate failure or out of credits recovery)
  React.useEffect(() => {
    if (restoreDraft) {
      setInputVal(restoreDraft.text);
      if (restoreDraft.files && restoreDraft.files.length > 0) {
        setAttachedFiles((prev) => {
          prev.forEach((item) => {
            if (item.previewUrl) {
              URL.revokeObjectURL(item.previewUrl);
            }
          });
          return restoreDraft.files!.map((file) => ({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            file,
            previewUrl: URL.createObjectURL(file),
          }));
        });
      }
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
      }

      // A restore/preset is a one-shot instruction. Once this input has
      // consumed it, clear the parent value so a later remount cannot
      // re-insert stale text or attachments.
      onRestoreDraftConsumed?.();
    }
  }, [restoreDraft?.trigger, onRestoreDraftConsumed]);

  const processFiles = async (files: File[]) => {
    if (files.length === 0) return;

    const MAX_FILES = 5;
    const currentCount = attachedFiles.length;
    const availableSlots = MAX_FILES - currentCount;

    if (availableSlots <= 0) {
      alert(`You can only attach up to ${MAX_FILES} files. Please remove an existing attachment first.`);
      return;
    }

    const legacyDocFiles: string[] = [];
    const invalidFiles: string[] = [];
    const videos = files.filter((file) => videoMime(file.name));
    if (videos.length && (files.length !== 1 || attachedFiles.length > 0)) {
      alert('For now, please upload one video at a time, without other attachments.');
      return;
    }
    if (videos.length && videos[0].size > VIDEO_LIMIT_BYTES) {
      alert('Videos must be 500 MB or smaller.');
      return;
    }
    if (videos.length) {
      const file = videos[0];
      const videoUrl = URL.createObjectURL(file);
      try {
        const duration = await new Promise<number>((resolve, reject) => {
          const video = document.createElement('video');
          video.preload = 'metadata';
          video.onloadedmetadata = () => resolve(video.duration);
          video.onerror = () => reject(new Error('Could not read video metadata.'));
          video.src = videoUrl;
        });
        if (!Number.isFinite(duration) || duration <= 0 || duration > VIDEO_LIMIT_SECONDS) {
          alert('Videos must be 90 minutes or shorter and have a readable duration.');
          return;
        }
      } catch {
        alert('Could not read the video duration. Please use a valid MP4, MOV or WebM file.');
        return;
      } finally {
        URL.revokeObjectURL(videoUrl);
      }
    }
    const validFiles: File[] = [];

    for (const file of files) {
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith('.doc') || file.type === 'application/msword') {
        legacyDocFiles.push(file.name);
        continue;
      }

      const isDocx =
        lowerName.endsWith('.docx') ||
        file.type ===
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const isTextFile = isTextFileName(file.name);
      const isValid =
        Boolean(videoMime(file.name)) ||
        file.type.startsWith('image/') ||
        file.type === 'application/pdf' ||
        lowerName.endsWith('.pdf') ||
        isDocx ||
        isTextFile;

      if (!isValid) {
        invalidFiles.push(file.name);
      } else {
        validFiles.push(file);
      }
    }

    let filesToAdd = validFiles;
    let limitExceeded = false;

    if (filesToAdd.length > availableSlots) {
      limitExceeded = true;
      filesToAdd = filesToAdd.slice(0, availableSlots);
    }

    const newItems: AttachedFileItem[] = filesToAdd.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    setAttachedFiles((prev) => [...prev, ...newItems]);

    // Construct combined alert message if needed
    const alertMessages: string[] = [];
    if (legacyDocFiles.length > 0) {
      alertMessages.push(
        `Legacy .doc files aren't supported. Please save the file as .docx and try again: ${legacyDocFiles.join(', ')}`
      );
    }
    if (invalidFiles.length > 0) {
      alertMessages.push(
        `The following file(s) are not supported images, videos, PDFs, DOCX, or text documents and were skipped: ${invalidFiles.join(', ')}`
      );
    }
    if (limitExceeded) {
      alertMessages.push(
        `Only ${MAX_FILES} files can be attached at a time. The remaining file(s) were skipped due to the limit.`
      );
    }
    if (alertMessages.length > 0) {
      alert(alertMessages.join('\n\n'));
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    processFiles(files);
    e.target.value = '';
  };

  const handleRemoveAttachment = (idToRemove: string) => {
    setAttachedFiles((prev) => {
      const item = prev.find((i) => i.id === idToRemove);
      if (item?.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
      }
      return prev.filter((i) => i.id !== idToRemove);
    });
  };

  const handleClearAllAttachments = () => {
    attachedFiles.forEach((item) => {
      if (item.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
      }
    });
    setAttachedFiles([]);
    setLightboxImageUrl(null);
  };

  const handleTranscript = useCallback((text: string) => {
    setIsRecording(false);
    setVoiceError(null);
    if (!text.trim()) {
      setVoiceError('No speech detected.');
      return;
    }
    setInputVal((prev) => {
      const clean = text.trim();
      if (!prev.trim()) return clean;
      const separator = /[\s]$/.test(prev) ? '' : ' ';
      return prev + separator + clean;
    });
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
        textareaRef.current.focus({ preventScroll: true });
      }
    }, 50);
  }, []);

  const handleRecorderCancel = useCallback(() => {
    setIsRecording(false);
    setTimeout(() => {
      textareaRef.current?.focus({ preventScroll: true });
    }, 50);
  }, []);

  const handleRecorderError = useCallback((errMsg: string) => {
    setIsRecording(false);
    setVoiceError(errMsg);
    setTimeout(() => {
      textareaRef.current?.focus({ preventScroll: true });
    }, 50);
  }, []);

  const handleSend = () => {
    if ((!inputVal.trim() && attachedFiles.length === 0) || isLoading || isLocked) return;
    onSendMessage(inputVal.trim(), attachedFiles.length > 0 ? attachedFiles.map(item => item.file) : undefined);
    
    setInputVal('');
    handleClearAllAttachments();
    
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputVal(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  };

  const activeSeatNames = seatOrder
    .filter((id) => activeModels.includes(id))
    .map((id) => COUNCIL_MEMBERS[id]?.name || id);

  const composerTarget =
    activeSeatNames.length === 1 ? activeSeatNames[0] : 'the panel';

  const composerPlaceholder = isCentered
    ? `Ask ${composerTarget}…`
    : `Reply to ${composerTarget}…`;

  const containerClasses = isCentered
    ? 'w-full pl-[max(clamp(0.75rem,calc(2vw_+_0.25rem),1.5rem),env(safe-area-inset-left))] pr-[max(clamp(0.75rem,calc(2vw_+_0.25rem),1.5rem),env(safe-area-inset-right))]'
    : 'shrink-0 bg-transparent pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[max(clamp(0.75rem,calc(2vw_+_0.25rem),2rem),env(safe-area-inset-left))] pr-[max(clamp(0.75rem,calc(2vw_+_0.25rem),2rem),env(safe-area-inset-right))] max-w-[760px] mx-auto w-full z-30';

  return (
    <div className={containerClasses}>
      {/* Hidden Attachment Input */}
      <input
        type="file"
        ref={attachmentInputRef}
        accept="image/*,video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.xml,.yaml,.yml,text/plain,text/markdown,text/csv,text/tab-separated-values,application/json,text/html,text/xml,application/xml,application/x-yaml,text/yaml"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Inner Composer Container: Applies max-w-2xl (672px) directly to composer content on desktop without consuming outer padding */}
      <div className={isCentered ? 'relative w-full max-w-[720px] mx-auto' : 'relative w-full'}>
        {/* Voice Error Notification Banner */}
        {voiceError && (
          <div className="mb-2 text-xs text-red-600 bg-red-50 border border-red-200/80 rounded-xl px-3 py-1.5 flex items-center justify-between animate-in fade-in">
            <span>{voiceError}</span>
            <button
              type="button"
              onClick={() => setVoiceError(null)}
              className="text-red-400 hover:text-red-700 ml-2 cursor-pointer p-0.5"
              title="Dismiss error"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Sleek, Wide Pill-Shaped Input Card */}
        <div className="relative rounded-[20px] bg-white border border-[#E2E0DB] pt-2.5 pr-2.5 pb-2 pl-3 transition-colors focus-within:border-[#D9D6CF] flex flex-col gap-2 min-w-0 max-w-full dashboard-input-shadow">
        {/* AI Seats: primary participant control, shared across desktop and mobile */}
        <AiSeatsCoachmark
          visible={showAiSeatsHint}
          onDismiss={() => onDismissAiSeatsHint?.()}
        >
          <AiSeatsControl
            seatOrder={seatOrder}
            activeModels={activeModels}
            onReorderSeats={onReorderSeats}
            onToggleModel={onToggleModel}
            disabled={isLoading}
          />
        </AiSeatsCoachmark>

        {/* Attached Files Preview Row */}
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2.5 pt-0.5 animate-in fade-in zoom-in-95 duration-150 min-w-0 max-w-full">
            {attachedFiles.map((item) => {
              const lowerName = item.file.name.toLowerCase();
              const isPdf = item.file.type === 'application/pdf' || lowerName.endsWith('.pdf');
              const isDocx =
                lowerName.endsWith('.docx') ||
                item.file.type ===
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
              const isTextFile = isTextFileName(item.file.name);
              const isVideo = Boolean(videoMime(item.file.name));

              return (
                <div key={item.id} className="relative self-start group">
                  {isPdf || isDocx ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (isPdf) window.open(item.previewUrl, '_blank');
                      }}
                      className={`flex min-h-[52px] w-[228px] max-w-[calc(100vw-5rem)] items-center gap-2.5 rounded-[12px] border border-[#E2E0DB] bg-[#F7F6F3] px-2.5 py-1.5 text-left transition-colors ${isPdf ? 'cursor-pointer hover:bg-[#EFEDE9] hover:border-[#D9D6CF]' : 'cursor-default'}`}
                      title={isPdf ? `Preview ${item.file.name}` : item.file.name}
                    >
                      <div className="flex h-10 w-8 shrink-0 items-center justify-center">
                        <img
                          src={isPdf ? '/file-icon-pdf.svg' : '/file-icon-docx.svg'}
                          alt=""
                          className="h-10 w-8 object-contain"
                          aria-hidden="true"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p
                          className="truncate text-[11px] font-medium leading-4 text-[#1C1B1A]"
                          title={item.file.name}
                        >
                          {item.file.name}
                        </p>
                        <p className="mt-0.5 text-[9px] leading-3 text-[#6A675F]">
                          {isPdf ? 'PDF document' : 'Word document'}
                        </p>
                      </div>
                    </button>
                  ) : isVideo ? (
                    <div
                      className="w-16 h-16 rounded-[24px] border border-zinc-200/90 overflow-hidden bg-zinc-100 flex flex-col items-center justify-center gap-1 p-1 select-none"
                      title={item.file.name}
                    >
                      <Video className="w-5 h-5 text-zinc-600" />
                      <span className="text-[9px] font-semibold text-zinc-600 uppercase tracking-wider bg-white/80 px-1 py-0.5 rounded border border-zinc-200/60">
                        VIDEO
                      </span>
                    </div>
                  ) : isTextFile ? (
                    <div
                      className="w-16 h-16 rounded-[24px] border border-zinc-200/90 overflow-hidden bg-zinc-100 flex flex-col items-center justify-center gap-1 p-1 select-none"
                      title={item.file.name}
                    >
                      <FileText className="w-5 h-5 text-emerald-600" />
                      <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider bg-white/80 px-1 py-0.2 rounded border border-zinc-200/60">
                        {getTextFileDisplayBadge(item.file.name)}
                      </span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setLightboxImageUrl(item.previewUrl)}
                      className="w-16 h-16 rounded-[24px] border border-zinc-200/90 overflow-hidden bg-zinc-100 block cursor-pointer hover:opacity-90 transition-opacity"
                      title={`Click to view ${item.file.name}`}
                    >
                      <img
                        src={item.previewUrl}
                        alt={item.file.name}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(item.id)}
                    className="absolute -top-1.5 -right-1.5 w-6 h-6 lg:w-5 lg:h-5 rounded-full bg-[#1C1B1A] text-white flex items-center justify-center shadow-md hover:bg-[#2A2927] active:scale-95 transition-all cursor-pointer z-10"
                    title="Remove attachment"
                    aria-label="Remove attachment"
                  >
                    <X className="w-3.5 h-3.5 lg:w-3 lg:h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Input Area: Either VoiceRecorder or Normal Textarea */}
        {isRecording ? (
          <VoiceRecorder
            onTranscript={handleTranscript}
            onCancel={handleRecorderCancel}
            onError={handleRecorderError}
          />
        ) : (
          <div className="flex items-end gap-1.5 sm:gap-2 min-w-0 max-w-full">
            {/* Attach icon & Popover */}
            <div className="relative shrink-0 sm:mb-0.5">
              <button
                ref={triggerRef}
                type="button"
                onClick={() => setIsUploadDrawerOpen((prev) => !prev)}
                title={isUploadDrawerOpen ? 'Close attachment menu' : 'Attach file'}
                aria-label={isUploadDrawerOpen ? 'Close attachment menu' : 'Attach file'}
                className={`w-11 h-11 sm:w-10 sm:h-10 rounded-[10px] transition-colors flex items-center justify-center cursor-pointer shrink-0 ${
                  isUploadDrawerOpen
                    ? 'text-[#1C1B1A] bg-[#EFEDE9]'
                    : 'text-[#6A675F] hover:text-[#1C1B1A] hover:bg-[#F7F6F3] active:bg-[#EFEDE9]'
                }`}
              >
                <Plus
                  className={`w-4 h-4 transition-transform duration-150 ease-out ${
                    isUploadDrawerOpen ? 'rotate-45 text-zinc-700' : 'rotate-0'
                  }`}
                />
              </button>

              {/* Upload File Popover */}
              <UploadFileDrawer
                isOpen={isUploadDrawerOpen}
                onClose={() => setIsUploadDrawerOpen(false)}
                triggerRef={triggerRef}
                onUploadFileClick={() => {
                  attachmentInputRef.current?.click();
                }}
              />
            </div>

            {/* Textarea: 16px (text-base) on mobile to prevent iOS Safari auto-zoom on focus */}
            <textarea
              ref={textareaRef}
              rows={1}
              value={inputVal}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={composerPlaceholder}
              className="w-full resize-none text-base sm:text-[15px] font-normal text-[#1C1B1A] placeholder:text-[#8A867D] bg-transparent focus:outline-none py-[11px] px-1 max-h-[160px] min-w-0"
            />

            {/* Voice Dictation Button */}
            {!isLoading && (
              <button
                type="button"
                onClick={() => {
                  setIsUploadDrawerOpen(false);
                  setVoiceError(null);
                  setIsRecording(true);
                }}
                className="w-11 h-11 sm:w-10 sm:h-10 rounded-[10px] text-[#6A675F] hover:text-[#1C1B1A] hover:bg-[#F7F6F3] active:bg-[#EFEDE9] transition-colors cursor-pointer shrink-0 flex items-center justify-center"
                title="Voice dictation"
                aria-label="Voice dictation"
              >
                <Mic className="w-4 h-4" />
              </button>
            )}

            {/* Send / Stop Button */}
            {isLoading ? (
              <button
                type="button"
                onClick={onStop}
                className="w-11 h-11 sm:w-10 sm:h-10 rounded-[10px] flex items-center justify-center transition-all shrink-0 cursor-pointer bg-[#1C1B1A] hover:bg-[#2A2927] active:scale-95 text-white"
                title="Stop generation"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={isLocked || (!inputVal.trim() && attachedFiles.length === 0)}
                className={`w-11 h-11 sm:w-10 sm:h-10 rounded-[10px] flex items-center justify-center transition-all shrink-0 active:scale-95 ${
                  !isLocked && (inputVal.trim() || attachedFiles.length > 0)
                    ? 'bg-[#1C1B1A] hover:bg-[#2A2927] text-white cursor-pointer'
                    : 'bg-[#EFEDE9] text-[#8A867D] cursor-not-allowed'
                }`}
                title="Send"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>
      </div>
      {/* Image Lightbox Modal */}
      <ImageLightbox
        isOpen={!!lightboxImageUrl}
        onClose={() => setLightboxImageUrl(null)}
        imageUrl={lightboxImageUrl}
      />
    </div>
  );
};
