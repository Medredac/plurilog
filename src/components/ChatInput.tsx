'use client';

import React, { useState, useRef } from 'react';
import { ArrowUp, Paperclip, Shuffle } from 'lucide-react';
import { PROMPT_SUGGESTIONS } from '../data/mockDebates';

interface ChatInputProps {
  onSendMessage: (content: string) => void;
  isLoading?: boolean;
  onSelectSuggestion?: (suggestion: string) => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  isLoading = false,
  onSelectSuggestion,
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

  const handleRandomTopic = () => {
    const randomIndex = Math.floor(Math.random() * PROMPT_SUGGESTIONS.length);
    const chosen = PROMPT_SUGGESTIONS[randomIndex];
    setInputVal(chosen.prompt);
    if (textareaRef.current) {
      textareaRef.current.focus();
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
    <div className="sticky bottom-0 bg-linear-to-t from-white via-white/95 to-transparent pt-2 pb-4 px-4 sm:px-6 max-w-3xl mx-auto w-full z-10">
      {/* Sleek Prompt Chips */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-2 mb-1">
        <button
          onClick={handleRandomTopic}
          className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white hover:bg-amber-50/70 border border-zinc-200/80 text-zinc-600 font-medium text-[11px] transition-colors shrink-0 shadow-2xs cursor-pointer"
          title="Random topic"
        >
          <Shuffle className="w-3 h-3 text-zinc-500" />
          <span>Random Topic</span>
        </button>

        {PROMPT_SUGGESTIONS.slice(0, 2).map((sugg, idx) => (
          <button
            key={idx}
            onClick={() => {
              setInputVal(sugg.prompt);
              if (onSelectSuggestion) onSelectSuggestion(sugg.prompt);
            }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white hover:bg-amber-50/70 border border-zinc-200/70 text-zinc-600 text-[11px] transition-colors shrink-0 shadow-2xs cursor-pointer truncate max-w-[240px]"
          >
            <span className="truncate">{sugg.title}</span>
          </button>
        ))}
      </div>

      {/* Sleek, Wide Pill-Shaped Input Card */}
      <div className="relative rounded-2xl bg-zinc-50 border border-zinc-200/80 shadow-sm p-2 sm:p-2.5 transition-all focus-within:bg-white focus-within:border-zinc-300 focus-within:ring-1 focus-within:ring-zinc-300">
        <div className="flex items-end gap-2">
          {/* Attach icon */}
          <button
            type="button"
            title="Attach file"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors hidden sm:flex items-center justify-center cursor-pointer shrink-0"
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
            className="w-full resize-none text-xs sm:text-sm font-normal text-zinc-900 placeholder:text-zinc-400 bg-transparent focus:outline-none py-1.5 px-1 max-h-[160px]"
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
