'use client';

import React, { useState, useRef } from 'react';
import { ArrowUp, Paperclip } from 'lucide-react';

interface ChatInputProps {
  onSendMessage: (content: string) => void;
  isLoading?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  isLoading = false,
}) => {
  const [inputVal, setInputVal] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (!inputVal.trim() || isLoading) return;
    onSendMessage(inputVal.trim());
    setInputVal('');
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

  return (
    <div className="sticky bottom-0 bg-linear-to-t from-white via-white/95 to-transparent pt-2 pb-5 px-4 sm:px-8 max-w-5xl mx-auto w-full z-10">
      {/* Sleek, Wide Pill-Shaped Input Card */}
      <div className="relative rounded-2xl bg-zinc-50 border border-zinc-200/80 shadow-sm p-2.5 sm:p-3 transition-all focus-within:bg-white focus-within:border-zinc-300 focus-within:ring-1 focus-within:ring-zinc-300">
        <div className="flex items-end gap-2">
          {/* Attach icon */}
          <button
            type="button"
            title="Attach file"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors hidden sm:flex items-center justify-center cursor-pointer shrink-0 mb-0.5"
          >
            <Paperclip className="w-4 h-4" />
          </button>

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

          {/* Send Button */}
          <button
            type="button"
            onClick={handleSend}
            disabled={!inputVal.trim() || isLoading}
            className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all shrink-0 cursor-pointer ${
              inputVal.trim() && !isLoading
                ? 'bg-amber-100 hover:bg-amber-200/90 text-amber-950 border border-amber-200 shadow-2xs'
                : 'bg-zinc-100 text-zinc-300 border border-zinc-200/60 cursor-not-allowed'
            }`}
            title="Send"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
