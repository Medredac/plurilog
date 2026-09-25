'use client';

import React, { useState, useRef, useCallback } from 'react';
import { ArrowUp, Plus, X, Square, FileText, Mic } from 'lucide-react';
import { UploadFileDrawer } from './UploadFileDrawer';
import { ImageLightbox } from './ImageLightbox';
import { VoiceRecorder } from './VoiceRecorder';
import { isTextFileName, getTextFileDisplayBadge } from '@/utils/textFileParser';

interface ChatInputProps {
  onSendMessage: (content: string, files?: File[]) => void;
  isLoading?: boolean;
  onStop?: () => void;
  isCentered?: boolean;
  autoFocus?: boolean;
  focusTrigger?: any;
  restoreDraft?: { text: string; files?: File[]; trigger: number } | null;
}

interface AttachedFileItem {
  id: string;
  file: File;
  previewUrl: string;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  isLoading = false,
  onStop,
  isCentered = false,
  autoFocus = false,
  focusTrigger,
  restoreDraft,
}) => {
  const [inputVal, setInputVal] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFileItem[]>([]);
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);
  const [isUploadDrawerOpen, setIsUploadDrawerOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
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
    }
  }, [restoreDraft?.trigger]);

  const getCameraFilename = (file: File): string => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const millis = String(now.getMilliseconds()).padStart(3, '0');

    let ext = 'jpg';
    const dotIndex = file.name.lastIndexOf('.');
    if (dotIndex !== -1) {
      const rawExt = file.name.slice(dotIndex + 1).toLowerCase().trim();
      const cleanExt = rawExt.replace(/[^a-z0-9]/g, '').slice(0, 10);
      if (cleanExt && cleanExt !== 'bin') {
        ext = cleanExt;
      }
    } else if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
      ext = 'jpg';
    } else if (file.type === 'image/png') {
      ext = 'png';
    } else if (file.type === 'image/webp') {
      ext = 'webp';
    } else if (file.type === 'image/gif') {
      ext = 'gif';
    }

    return `Photo_${year}${month}${day}_${hours}${minutes}${seconds}_${millis}.${ext}`;
  };

  const processFiles = (files: File[]) => {
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
        `The following file(s) are not supported images, PDFs, DOCX, or text documents and were skipped: ${invalidFiles.join(', ')}`
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

  const handleCameraFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFile = e.target.files?.[0];
    if (rawFile) {
      const generatedName = getCameraFilename(rawFile);
      const renamedFile = new File([rawFile], generatedName, {
        type: rawFile.type || 'image/jpeg',
        lastModified: rawFile.lastModified || Date.now(),
      });
      processFiles([renamedFile]);
    }
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
    if ((!inputVal.trim() && attachedFiles.length === 0) || isLoading) return;
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

  const containerClasses = isCentered
    ? 'w-full pl-[max(clamp(0.75rem,calc(2vw_+_0.25rem),1.5rem),env(safe-area-inset-left))] pr-[max(clamp(0.75rem,calc(2vw_+_0.25rem),1.5rem),env(safe-area-inset-right))]'
    : 'shrink-0 bg-linear-to-t from-white via-white/95 to-transparent pt-2 pb-[max(clamp(0.75rem,calc(1.5vw_+_0.375rem),1.25rem),env(safe-area-inset-bottom))] pl-[max(clamp(0.75rem,calc(2vw_+_0.25rem),2rem),env(safe-area-inset-left))] pr-[max(clamp(0.75rem,calc(2vw_+_0.25rem),2rem),env(safe-area-inset-right))] max-w-5xl mx-auto w-full z-10';

  return (
    <div className={containerClasses}>
      {/* Hidden File Inputs */}
      <input
        type="file"
        ref={cameraInputRef}
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleCameraFileSelect}
      />
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />
      <input
        type="file"
        ref={docInputRef}
        accept=".pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.xml,.yaml,.yml,text/plain,text/markdown,text/csv,text/tab-separated-values,application/json,text/html,text/xml,application/xml,application/x-yaml,text/yaml"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Inner Composer Container: Applies max-w-2xl (672px) directly to composer content on desktop without consuming outer padding */}
      <div className={isCentered ? 'w-full max-w-2xl mx-auto' : 'w-full'}>
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
        <div className={`relative rounded-2xl bg-zinc-50 border border-zinc-200/80 p-2.5 sm:p-3 transition-all focus-within:bg-white focus-within:border-zinc-300 focus-within:ring-1 focus-within:ring-zinc-300 flex flex-col gap-2 min-w-0 max-w-full ${
          isCentered ? 'shadow-md shadow-zinc-100 hover:border-zinc-300' : 'shadow-sm'
        }`}>
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

              return (
                <div key={item.id} className="relative self-start group">
                  {isPdf ? (
                    <button
                      type="button"
                      onClick={() => window.open(item.previewUrl, '_blank')}
                      className="w-16 h-16 rounded-xl border border-zinc-200/90 overflow-hidden bg-zinc-100 shadow-2xs flex flex-col items-center justify-center gap-1 cursor-pointer hover:bg-zinc-200/60 transition-colors p-1"
                      title={`Click to view ${item.file.name} in new tab`}
                    >
                      <FileText className="w-5 h-5 text-red-500" />
                      <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider bg-white/80 px-1 py-0.2 rounded border border-zinc-200/60">
                        PDF
                      </span>
                    </button>
                  ) : isDocx ? (
                    <div
                      className="w-16 h-16 rounded-xl border border-zinc-200/90 overflow-hidden bg-zinc-100 shadow-2xs flex flex-col items-center justify-center gap-1 p-1 select-none"
                      title={item.file.name}
                    >
                      <FileText className="w-5 h-5 text-blue-600" />
                      <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider bg-white/80 px-1 py-0.2 rounded border border-zinc-200/60">
                        DOCX
                      </span>
                    </div>
                  ) : isTextFile ? (
                    <div
                      className="w-16 h-16 rounded-xl border border-zinc-200/90 overflow-hidden bg-zinc-100 shadow-2xs flex flex-col items-center justify-center gap-1 p-1 select-none"
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
                      className="w-16 h-16 rounded-xl border border-zinc-200/90 overflow-hidden bg-zinc-100 shadow-2xs block cursor-pointer hover:opacity-90 transition-opacity"
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
                    className="absolute -top-1.5 -right-1.5 w-6 h-6 lg:w-5 lg:h-5 rounded-full bg-zinc-900 text-white flex items-center justify-center shadow-md hover:bg-zinc-700 active:scale-95 transition-all cursor-pointer z-10"
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
                className={`p-2 rounded-lg transition-colors flex items-center justify-center cursor-pointer target-primary ${
                  isUploadDrawerOpen
                    ? 'text-zinc-700 bg-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 active:bg-zinc-200/60'
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
                onTakePhotoClick={() => {
                  cameraInputRef.current?.click();
                }}
                onUploadImageClick={() => {
                  fileInputRef.current?.click();
                }}
                onUploadFileClick={() => {
                  docInputRef.current?.click();
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
              placeholder="Type a topic..."
              className="w-full resize-none text-base sm:text-base font-normal text-zinc-900 placeholder:text-zinc-400 bg-transparent focus:outline-none py-[9px] sm:py-1.5 px-1 max-h-[160px] min-w-0"
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
                className="p-2 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 active:bg-zinc-200/60 transition-colors cursor-pointer shrink-0 sm:mb-0.5 flex items-center justify-center target-primary"
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
                className="w-9 h-9 rounded-full flex items-center justify-center transition-all shrink-0 cursor-pointer bg-zinc-900 hover:bg-zinc-800 active:scale-95 text-white shadow-2xs target-primary"
                title="Stop generation"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!inputVal.trim() && attachedFiles.length === 0}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-all shrink-0 active:scale-95 target-primary ${
                  inputVal.trim() || attachedFiles.length > 0
                    ? 'bg-zinc-900 hover:bg-zinc-800 text-white shadow-2xs cursor-pointer'
                    : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
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
