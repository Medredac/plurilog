'use client';

import React, { useState } from 'react';
import { 
  PanelLeft, 
  Share2, 
  Loader2,
  GripVertical
} from 'lucide-react';
import { COUNCIL_MEMBERS } from '../data/mockDebates';
import { ModelId, SeatStatus } from '../types/chat';

interface CouncilHeaderProps {
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  seatOrder: ModelId[];
  onReorderSeats: (newOrder: ModelId[]) => void;
  activeModels: ModelId[];
  onToggleModel: (id: ModelId) => void;
  isDebating?: boolean;
  activeSpeaker?: ModelId | null;
  seatStatuses?: Record<ModelId, SeatStatus>;
}

export const CouncilHeader: React.FC<CouncilHeaderProps> = ({
  isSidebarOpen,
  onToggleSidebar,
  seatOrder,
  onReorderSeats,
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
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (isDebating) return;
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const newOrder = [...seatOrder];
    const [movedItem] = newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, movedItem);

    onReorderSeats(newOrder);
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  return (
    <header className="sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b border-zinc-100 px-4 sm:px-6 py-2">
      <div className="flex items-center justify-between gap-3">
        {/* Left: Sidebar toggle and the draggable model pills */}
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleSidebar}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 border border-zinc-200/70 transition-colors cursor-pointer"
            title={isSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            aria-label="Toggle sidebar"
          >
            <PanelLeft className="w-4 h-4" />
          </button>

          {/* Draggable Model Pills */}
          <div className="flex items-center gap-1.5">
            {seatOrder.map((id, idx) => {
              const member = COUNCIL_MEMBERS[id];
              const isSelected = activeModels.includes(id);
              const currentStatus = seatStatuses[id] || 'idle';
              const isSpeaking = currentStatus === 'speaking' || activeSpeaker === id;
              const isBeingDragged = draggedIndex === idx;
              const isTargetOver = dragOverIndex === idx;

              return (
                <div
                  key={id}
                  draggable={!isDebating}
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDrop={(e) => handleDrop(e, idx)}
                  onDragEnd={handleDragEnd}
                  className={`group relative flex items-center rounded-lg transition-all select-none ${
                    isDebating ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
                  } ${isBeingDragged ? 'opacity-40 scale-95' : ''} ${
                    isTargetOver ? 'ring-2 ring-amber-400 ring-offset-1 scale-105' : ''
                  }`}
                  title={
                    isDebating
                      ? `${member?.name || id} (deliberating...)`
                      : `Drag to reorder seat sequence • Click to ${isSelected ? 'remove' : 'include'}`
                  }
                >
                  <button
                    type="button"
                    onClick={() => onToggleModel(id)}
                    className={`flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-lg border text-xs font-medium transition-all cursor-pointer ${
                      isSpeaking
                        ? 'bg-amber-50 text-zinc-900 border-amber-300 shadow-2xs font-semibold'
                        : isSelected
                        ? 'bg-zinc-50 text-zinc-800 border-zinc-200/80 hover:bg-zinc-100/70'
                        : 'bg-white text-zinc-400 border-zinc-200/50 opacity-50 line-through hover:opacity-75'
                    }`}
                  >
                    <GripVertical className="w-3 h-3 text-zinc-300 group-hover:text-zinc-500 transition-colors -ml-0.5" />
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        isSpeaking
                          ? 'bg-amber-500 animate-pulse'
                          : isSelected
                          ? member?.statusDotColor || 'bg-zinc-500'
                          : 'bg-zinc-300'
                      }`}
                    />
                    <span>{member?.name || id}</span>
                  </button>
                </div>
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
