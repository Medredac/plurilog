'use client';

import React from 'react';
import { 
  PanelLeft, 
  Share2, 
  Loader2
} from 'lucide-react';
import { COUNCIL_MEMBERS } from '../data/mockDebates';
import { ModelId, SeatStatus } from '../types/chat';

interface CouncilHeaderProps {
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  activeModels: ModelId[];
  onToggleModel: (id: ModelId) => void;
  isDebating?: boolean;
  activeSpeaker?: ModelId | null;
  seatStatuses?: Record<ModelId, SeatStatus>;
}

export const CouncilHeader: React.FC<CouncilHeaderProps> = ({
  isSidebarOpen,
  onToggleSidebar,
  activeModels,
  onToggleModel,
  isDebating = false,
  activeSpeaker = null,
  seatStatuses = {
    'gemini': 'idle',
    'claude': 'idle',
    'chatgpt': 'idle',
  },
}) => {
  const models: ModelId[] = ['gemini', 'claude', 'chatgpt'];

  return (
    <header className="sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b border-zinc-100 px-4 sm:px-6 py-2">
      <div className="flex items-center justify-between gap-3">
        {/* Left: Sidebar toggle and the 3 clean model indicators */}
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleSidebar}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 border border-zinc-200/70 transition-colors cursor-pointer"
            title={isSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            aria-label="Toggle sidebar"
          >
            <PanelLeft className="w-4 h-4" />
          </button>

          {/* Clean Model Pills: Gemini, Claude, ChatGPT (No subtitles, no extra badges) */}
          <div className="flex items-center gap-1.5">
            {models.map((id) => {
              const member = COUNCIL_MEMBERS[id];
              const isSelected = activeModels.includes(id);
              const currentStatus = seatStatuses[id] || 'idle';
              const isSpeaking = currentStatus === 'speaking' || activeSpeaker === id;

              return (
                <button
                  key={id}
                  onClick={() => onToggleModel(id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-all cursor-pointer ${
                    isSpeaking
                      ? 'bg-amber-50 text-zinc-900 border-amber-300 shadow-2xs font-semibold'
                      : isSelected
                      ? 'bg-zinc-50 text-zinc-800 border-zinc-200/80 hover:bg-zinc-100/70'
                      : 'bg-white text-zinc-400 border-zinc-200/50 opacity-60'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isSpeaking ? 'bg-amber-500 animate-pulse' : isSelected ? member.statusDotColor : 'bg-zinc-300'
                    }`}
                  />
                  <span>{member.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Clean minimal status / share */}
        <div className="flex items-center gap-2">
          {isDebating && (
            <div className="flex items-center gap-1.5 text-xs text-amber-900 bg-amber-50 px-2.5 py-0.5 rounded-md border border-amber-200/70">
              <Loader2 className="w-3 h-3 animate-spin text-amber-700" />
              <span>Responding...</span>
            </div>
          )}

          <button
            title="Share discussion"
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 border border-zinc-200/60 transition-colors cursor-pointer"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Share</span>
          </button>
        </div>
      </div>
    </header>
  );
};
