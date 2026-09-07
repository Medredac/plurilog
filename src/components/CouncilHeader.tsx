'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Power
} from 'lucide-react';
import { COUNCIL_MEMBERS } from '../data/mockDebates';
import { ModelId, SeatStatus } from '../types/chat';

interface CouncilHeaderProps {
  seatOrder: ModelId[];
  onReorderSeats: (newOrder: ModelId[]) => void;
  activeModels: ModelId[];
  onToggleModel: (id: ModelId) => void;
  isDebating?: boolean;
  activeSpeaker?: ModelId | null;
  seatStatuses?: Record<ModelId, SeatStatus>;
  isOutOfCredits?: boolean;
  isLowCredit?: boolean;
  onUpgradeClick?: () => void;
}

export const CouncilHeader: React.FC<CouncilHeaderProps> = ({
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
  isOutOfCredits = false,
  isLowCredit = false,
  onUpgradeClick,
}) => {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isMobilePanelOpen, setIsMobilePanelOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close mobile panel on click outside
  useEffect(() => {
    const handleClickOutside = (event: PointerEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setIsMobilePanelOpen(false);
      }
    };

    if (isMobilePanelOpen) {
      document.addEventListener('pointerdown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside);
    };
  }, [isMobilePanelOpen]);

  const handleDragStart = (e: any, index: number) => {
    if (isDebating) return;
    setDraggedIndex(index);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    }
  };

  const handleDragOver = (e: any, index: number) => {
    if (e.preventDefault) e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    setDragOverIndex(index);
  };

  const handleDrop = (e: any, targetIndex: number) => {
    if (e.preventDefault) e.preventDefault();
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

  const activeSpeakerMember = activeSpeaker ? COUNCIL_MEMBERS[activeSpeaker] : null;

  return (
    <header className="sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b border-zinc-100 pl-[max(3rem,calc(env(safe-area-inset-left)+2.5rem))] nav-rail:pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] lg:pr-[max(1.5rem,env(safe-area-inset-right))] py-1.5 lg:py-2">
      <div className="flex items-center justify-between gap-1.5 sm:gap-3 flex-nowrap min-w-0">
        
        {/* MOBILE (< lg): Compact Council trigger button */}
        <div className="flex lg:hidden items-center min-w-0">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setIsMobilePanelOpen(!isMobilePanelOpen)}
            className={`flex items-center gap-1.5 py-1 px-2.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer select-none min-w-0 max-w-full ${
              isMobilePanelOpen
                ? 'bg-zinc-100 text-zinc-900 border-zinc-300 shadow-2xs'
                : isDebating
                ? 'bg-amber-50 text-amber-900 border-amber-300 shadow-2xs'
                : 'bg-zinc-50 hover:bg-zinc-100 text-zinc-700 border-zinc-200/80'
            }`}
            aria-label="Toggle Council Configuration Panel"
            title="Toggle Council Configuration Panel"
          >
            {isDebating ? (
              <Loader2 className="w-3 h-3 animate-spin text-amber-700 shrink-0" />
            ) : (
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 shrink-0" />
            )}

            <span className="truncate">
              {isDebating
                ? activeSpeakerMember?.name || 'Council'
                : 'Council'}
            </span>

            <ChevronDown
              className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-150 shrink-0 ${
                isMobilePanelOpen ? 'rotate-180 text-zinc-600' : ''
              }`}
            />
          </button>
        </div>

        {/* DESKTOP (lg+): Original horizontal draggable model pills strip */}
        <div className="hidden lg:flex items-center gap-1.5">
          {seatOrder.map((id, idx) => {
            const member = COUNCIL_MEMBERS[id];
            const isSelected = activeModels.includes(id);

            const handleSwap = (e: React.MouseEvent, targetIdx: number) => {
              e.stopPropagation();
              if (isDebating || targetIdx < 0 || targetIdx >= seatOrder.length) return;
              const newOrder = [...seatOrder];
              [newOrder[idx], newOrder[targetIdx]] = [newOrder[targetIdx], newOrder[idx]];
              onReorderSeats(newOrder);
            };

            const currentStatus = seatStatuses[id] || 'idle';
            const isSpeaking = currentStatus === 'speaking' || activeSpeaker === id;
            const isBeingDragged = draggedIndex === idx;
            const isTargetOver = dragOverIndex === idx;

            return (
              <motion.div
                key={id}
                layout="position"
                transition={{ type: 'tween', duration: 0.25, ease: 'easeInOut' }}
                draggable={!isDebating}
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDrop={(e) => handleDrop(e, idx)}
                onDragEnd={handleDragEnd}
                className={`group relative flex items-center rounded-lg border text-xs transition-colors select-none ${
                  isDebating ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
                } ${isBeingDragged ? 'opacity-40' : ''} ${
                  isTargetOver ? 'ring-2 ring-amber-400 ring-offset-1' : ''
                } ${
                  isSpeaking
                    ? 'bg-amber-50 text-zinc-800 border-amber-300 shadow-2xs'
                    : isSelected
                    ? 'bg-zinc-50 text-zinc-600 border-zinc-200/80 hover:bg-zinc-100/70 hover:text-zinc-800 font-medium'
                    : 'bg-white text-zinc-400 border-zinc-200/50 opacity-50 hover:opacity-75 font-normal'
                }`}
                title={
                  isDebating
                    ? `${member?.name || id} (deliberating...)`
                    : `Drag to reorder • Use chevrons to swap • Power button to ${isSelected ? 'turn off' : 'turn on'}`
                }
              >
                {/* Left Chevron Swap Button */}
                <button
                  type="button"
                  onClick={(e) => handleSwap(e, idx - 1)}
                  disabled={idx === 0 || isDebating}
                  aria-label={`Move ${member?.name || id} earlier`}
                  className="p-1 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200/60 rounded-l-md transition-colors disabled:opacity-0 disabled:pointer-events-none cursor-pointer"
                >
                  <ChevronLeft className="w-3 h-3" />
                </button>

                {/* Status Dot */}
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 mx-1 ${
                    isSpeaking
                      ? 'bg-amber-500 animate-pulse'
                      : isSelected
                      ? member?.statusDotColor || 'bg-zinc-500'
                      : 'bg-zinc-300'
                  }`}
                />

                {/* Model Name */}
                <span className={`pr-1 select-none ${!isSelected ? 'line-through text-zinc-400' : ''}`}>
                  {member?.name || id}
                </span>

                {/* Right Chevron Swap Button */}
                <button
                  type="button"
                  onClick={(e) => handleSwap(e, idx + 1)}
                  disabled={idx === seatOrder.length - 1 || isDebating}
                  aria-label={`Move ${member?.name || id} later`}
                  className="p-1 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200/60 transition-colors disabled:opacity-0 disabled:pointer-events-none cursor-pointer"
                >
                  <ChevronRight className="w-3 h-3" />
                </button>

                {/* Dedicated Power Toggle Button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleModel(id);
                  }}
                  aria-label={`${isSelected ? 'Turn off' : 'Turn on'} ${member?.name || id}`}
                  className={`p-1 pl-1.5 pr-1.5 border-l border-zinc-200/70 rounded-r-md transition-colors cursor-pointer ${
                    isSelected 
                      ? 'text-zinc-400 hover:text-red-600 hover:bg-red-50' 
                      : 'text-zinc-300 hover:text-emerald-600 hover:bg-emerald-50'
                  }`}
                  title={isSelected ? `Disable ${member?.name || id}` : `Enable ${member?.name || id}`}
                >
                  <Power className={`w-3 h-3 ${isSelected ? 'text-zinc-500 hover:text-red-600' : 'text-zinc-400'}`} />
                </button>
              </motion.div>
            );
          })}
        </div>

        {/* Right: Deliberation status and out of credits badge */}
        <div className="flex items-center gap-2 shrink-0">
          {isOutOfCredits && (
            <div className="flex items-center gap-1.5 text-xs font-medium text-red-800 bg-red-50 px-2.5 py-0.5 rounded-md border border-red-200/70">
              <span className="hidden sm:inline">Free credits used —</span>
              <button 
                type="button" 
                onClick={onUpgradeClick || (() => {})} 
                className="underline hover:no-underline cursor-pointer"
              >
                Upgrade
              </button>
            </div>
          )}

          {isLowCredit && !isOutOfCredits && (
            <div className="flex items-center gap-1.5 text-xs font-medium text-red-800 bg-red-50 px-2.5 py-0.5 rounded-md border border-red-200/70">
              <span className="hidden sm:inline">Almost out of free credit —</span>
              <button type="button" onClick={onUpgradeClick || (() => {})} className="underline hover:no-underline cursor-pointer">
                Upgrade
              </button>
            </div>
          )}

          {isDebating && (
            <div className="hidden lg:flex items-center gap-1.5 text-xs font-medium text-amber-900 bg-amber-50 px-2.5 py-0.5 rounded-md border border-amber-200/70">
              <Loader2 className="w-3 h-3 animate-spin text-amber-700" />
              <span>Responding...</span>
            </div>
          )}
        </div>
      </div>

      {/* MOBILE (< lg): Vertical Council Configuration Dropdown Panel */}
      {isMobilePanelOpen && (
        <div
          ref={panelRef}
          className="lg:hidden absolute top-full left-12 mt-1.5 w-72 max-w-[calc(100vw-3.75rem)] max-h-[calc(100dvh-4rem)] overflow-y-auto p-2 bg-white rounded-2xl border border-zinc-200/90 shadow-xl z-30 animate-in fade-in zoom-in-95 duration-150 space-y-1.5"
        >
          {seatOrder.map((id, idx) => {
            const member = COUNCIL_MEMBERS[id];
            const isSelected = activeModels.includes(id);

            const handleSwap = (e: React.MouseEvent, targetIdx: number) => {
              e.stopPropagation();
              if (isDebating || targetIdx < 0 || targetIdx >= seatOrder.length) return;
              const newOrder = [...seatOrder];
              [newOrder[idx], newOrder[targetIdx]] = [newOrder[targetIdx], newOrder[idx]];
              onReorderSeats(newOrder);
            };

            const currentStatus = seatStatuses[id] || 'idle';
            const isSpeaking = currentStatus === 'speaking' || activeSpeaker === id;

            return (
              <motion.div
                key={id}
                layout="position"
                transition={{ type: 'tween', duration: 0.25, ease: 'easeInOut' }}
                className={`flex items-center justify-between p-2 rounded-xl border transition-colors select-none ${
                  isSpeaking
                    ? 'bg-amber-50 text-zinc-800 border-amber-300 shadow-2xs'
                    : isSelected
                    ? 'bg-zinc-50 text-zinc-700 border-zinc-200/80'
                    : 'bg-white text-zinc-400 border-zinc-200/50 opacity-50'
                }`}
              >
                {/* Left: Status Dot & Model Name */}
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      isSpeaking
                        ? 'bg-amber-500 animate-pulse'
                        : isSelected
                        ? member?.statusDotColor || 'bg-zinc-500'
                        : 'bg-zinc-300'
                    }`}
                  />
                  <span className={`text-xs font-medium truncate ${!isSelected ? 'line-through text-zinc-400' : ''}`}>
                    {member?.name || id}
                  </span>
                </div>

                {/* Right: Vertical Reorder Column & Power Toggle */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Vertical Reorder Column */}
                  <div className="flex flex-col items-center justify-center shrink-0 w-6">
                    {/* Up Swap Button / Spacer */}
                    {idx > 0 ? (
                      <button
                        type="button"
                        onClick={(e) => handleSwap(e, idx - 1)}
                        disabled={isDebating}
                        aria-label={`Move ${member?.name || id} up`}
                        className="p-1 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200/60 transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer flex items-center justify-center"
                        title={`Move ${member?.name || id} earlier`}
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <div className="h-[22px] w-full" aria-hidden="true" />
                    )}

                    {/* Down Swap Button / Spacer */}
                    {idx < seatOrder.length - 1 ? (
                      <button
                        type="button"
                        onClick={(e) => handleSwap(e, idx + 1)}
                        disabled={isDebating}
                        aria-label={`Move ${member?.name || id} down`}
                        className="p-1 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200/60 transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer flex items-center justify-center"
                        title={`Move ${member?.name || id} later`}
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <div className="h-[22px] w-full" aria-hidden="true" />
                    )}
                  </div>

                  {/* Power Toggle Button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleModel(id);
                    }}
                    aria-label={`${isSelected ? 'Turn off' : 'Turn on'} ${member?.name || id}`}
                    className={`p-1.5 rounded-lg border transition-colors cursor-pointer flex items-center justify-center ${
                      isSelected 
                        ? 'text-zinc-500 hover:text-red-600 bg-white border-zinc-200 hover:bg-red-50 hover:border-red-200' 
                        : 'text-zinc-300 hover:text-emerald-600 bg-zinc-50 border-zinc-200/60 hover:bg-emerald-50 hover:border-emerald-200'
                    }`}
                    title={isSelected ? `Disable ${member?.name || id}` : `Enable ${member?.name || id}`}
                  >
                    <Power className={`w-3.5 h-3.5 ${isSelected ? 'text-zinc-600 hover:text-red-600' : 'text-zinc-400'}`} />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </header>
  );
};
