'use client';

import React, { useState, useRef } from 'react';
import { ArrowUp, Paperclip, X, Square } from 'lucide-react';
import { UploadFileDrawer } from './UploadFileDrawer';
import { ImageLightbox } from './ImageLightbox';

interface ChatInputProps {
  onSendMessage: (content: string, imageFile?: File) => void;
  isLoading?: boolean;
  onStop?: () => void;
  isCentered?: boolean;
  autoFocus?: boolean;
  focusTrigger?: any;
  restoreDraft?: { text: string; trigger: number } | null;
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
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [isUploadDrawerOpen, setIsUploadDrawerOpen] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Automatically focus textarea on mount, empty state, or when switching discussions
  React.useEffect(() => {
    const timer = setTimeout(() => {
      textareaRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [isCentered, autoFocus, focusTrigger]);

  // Restore draft prompt text when requested (e.g. out of credits recovery)
  React.useEffect(() => {
    if (restoreDraft) {
      setInputVal(restoreDraft.text);
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
      }
    }
  }, [restoreDraft?.trigger]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please select a valid image file.');
      return;
    }

    setAttachedFile(file);
    const objectUrl = URL.createObjectURL(file);
    setImagePreviewUrl(objectUrl);

    // Clear input so same file can be selected again if needed
    e.target.value = '';
  };

  const handleRemoveAttachment = () => {
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setAttachedFile(null);
    setImagePreviewUrl(null);
    setIsLightboxOpen(false);
  };

  const handleSend = () => {
    if ((!inputVal.trim() && !attachedFile) || isLoading) return;
    onSendMessage(inputVal.trim() || 'Attached an image for discussion.', attachedFile || undefined);
    
    setInputVal('');
    handleRemoveAttachment();
    
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
    ? 'w-full max-w-2xl mx-auto'
    : 'sticky bottom-0 bg-linear-to-t from-white via-white/95 to-transparent pt-2 pb-5 px-4 sm:px-8 max-w-5xl mx-auto w-full z-10';

  return (
    <div className={containerClasses}>
      {/* Hidden File Inputs */}
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />
      <input
        type="file"
        ref={docInputRef}
        accept=".pdf,application/pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Sleek, Wide Pill-Shaped Input Card */}
      <div className={`relative rounded-2xl bg-zinc-50 border border-zinc-200/80 p-2.5 sm:p-3 transition-all focus-within:bg-white focus-within:border-zinc-300 focus-within:ring-1 focus-within:ring-zinc-300 flex flex-col gap-2 ${
        isCentered ? 'shadow-md shadow-zinc-100 hover:border-zinc-300' : 'shadow-sm'
      }`}>
        {/* Attached Image Thumbnail Preview */}
        {imagePreviewUrl && (
          <div className="relative self-start group animate-in fade-in zoom-in-95 duration-150">
            <button
              type="button"
              onClick={() => setIsLightboxOpen(true)}
              className="w-16 h-16 rounded-xl border border-zinc-200/90 overflow-hidden bg-zinc-100 shadow-2xs block cursor-pointer hover:opacity-90 transition-opacity"
              title="Click to view full image"
            >
              <img
                src={imagePreviewUrl}
                alt="Selected attachment"
                className="w-full h-full object-cover"
              />
            </button>
            <button
              type="button"
              onClick={handleRemoveAttachment}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-zinc-900 text-white flex items-center justify-center shadow-md hover:bg-zinc-700 transition-colors cursor-pointer z-10"
              title="Remove attachment"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          {/* Attach icon & Popover */}
          <div className="relative shrink-0 mb-0.5">
            <button
              ref={triggerRef}
              type="button"
              onClick={() => setIsUploadDrawerOpen((prev) => !prev)}
              title="Attach file"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors flex items-center justify-center cursor-pointer"
            >
              <Paperclip className="w-4 h-4" />
            </button>

            {/* Upload File Popover */}
            <UploadFileDrawer
              isOpen={isUploadDrawerOpen}
              onClose={() => setIsUploadDrawerOpen(false)}
              triggerRef={triggerRef}
              onUploadImageClick={() => {
                fileInputRef.current?.click();
              }}
              onUploadFileClick={() => {
                docInputRef.current?.click();
              }}
            />
          </div>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputVal}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Type a topic for discussion..."
            className="w-full resize-none text-sm sm:text-base font-normal text-zinc-900 placeholder:text-zinc-400 bg-transparent focus:outline-none py-1.5 px-1 max-h-[160px]"
          />

          {/* Send / Stop Button */}
          {isLoading ? (
            <button
              type="button"
              onClick={onStop}
              className="w-8 h-8 rounded-xl flex items-center justify-center transition-all shrink-0 cursor-pointer bg-zinc-900 hover:bg-zinc-800 text-white shadow-2xs"
              title="Stop generation"
            >
              <Square className="w-3 h-3 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!inputVal.trim() && !attachedFile}
              className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all shrink-0 cursor-pointer ${
                inputVal.trim() || attachedFile
                  ? 'bg-amber-50/80 hover:bg-amber-100/90 text-amber-900 border border-amber-200/80 shadow-2xs'
                  : 'bg-zinc-100 text-zinc-300 border border-zinc-200/60 cursor-not-allowed'
              }`}
              title="Send"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      {/* Image Lightbox Modal */}
      <ImageLightbox
        isOpen={isLightboxOpen}
        onClose={() => setIsLightboxOpen(false)}
        imageUrl={imagePreviewUrl}
      />
    </div>
  );
};
