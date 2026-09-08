'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  X,
  Plus,
  GripVertical
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

  // Close mobile/compact panel on click outside or Escape key
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

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMobilePanelOpen(false);
        triggerRef.current?.focus();
      }
    };

    if (isMobilePanelOpen) {
      document.addEventListener('pointerdown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
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

  const metaRequirement = (isLowCredit && isDebating)
    ? 'wide-active-credit'
    : (isLowCredit || isOutOfCredits)
    ? 'credit-warning'
    : 'normal';

  return (
    <header
      data-council-meta={metaRequirement}
      className="council-container sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b border-zinc-100 pl-[max(4.125rem,calc(env(safe-area-inset-left)+3.375rem))] nav-rail:pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] lg:pr-[max(1.5rem,env(safe-area-inset-right))] py-1.5 lg:py-2"
    >
      <div className="flex items-center justify-between gap-1.5 sm:gap-3 flex-nowrap min-w-0">
        
        {/* COMPACT MODE: Container-responsive trigger button */}
        <div className="council-compact-only flex items-center min-w-0">
          <button
            id="council-trigger"
            ref={triggerRef}
            type="button"
            onClick={() => setIsMobilePanelOpen(!isMobilePanelOpen)}
            className={`flex items-center gap-1.5 py-1 px-2.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer select-none min-w-0 max-w-full target-primary ${
              isMobilePanelOpen
                ? 'bg-zinc-100 text-zinc-900 border-zinc-300 shadow-2xs'
                : isDebating
                ? 'bg-amber-50 text-amber-900 border-amber-300 shadow-2xs'
                : 'bg-zinc-50 hover:bg-zinc-100 text-zinc-700 border-zinc-200/80'
            }`}
            aria-haspopup="dialog"
            aria-expanded={isMobilePanelOpen}
            aria-controls="council-panel"
            aria-label="Toggle Panel Configuration"
            title="Toggle Panel Configuration"
          >
            {isDebating ? (
              <Loader2 className="w-3 h-3 animate-spin text-amber-700 shrink-0" />
            ) : (
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 shrink-0" />
            )}

            <span className="truncate">
              {isDebating
                ? activeSpeakerMember?.name || 'Panel'
                : 'Panel'}
            </span>

            <ChevronDown
              className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-150 shrink-0 ${
                isMobilePanelOpen ? 'rotate-180 text-zinc-600' : ''
              }`}
            />
          </button>
        </div>

        {/* FULL INLINE MODE: Container-responsive horizontal model pills */}
        <div className="council-inline-only hidden items-center gap-1.5">
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
                    : `Drag to reorder • Click ${isSelected ? '× to remove' : '+ to add'}`
                }
              >
                {/* Fine Pointer Only: Clean Drag Handle */}
                <div 
                  className="panel-drag-handle items-center pl-2 pr-0.5 text-zinc-300 group-hover:text-zinc-500 transition-colors"
                  aria-hidden="true"
                >
                  <GripVertical className="w-3.5 h-3.5 shrink-0" />
                </div>

                {/* Touch / Hybrid Pointer: Explicit Reorder Chevron (Left/Earlier) */}
                <button
                  type="button"
                  onClick={(e) => handleSwap(e, idx - 1)}
                  disabled={idx === 0 || isDebating}
                  aria-label={`Move ${member?.name || id} earlier`}
                  className="panel-touch-reorder p-1.5 min-w-[36px] min-h-[36px] text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200/60 rounded-l-md transition-colors disabled:opacity-0 disabled:pointer-events-none cursor-pointer items-center justify-center"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>

                {/* Status Dot */}
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 mx-1.5 ${
                    isSpeaking
                      ? 'bg-amber-500 animate-pulse'
                      : isSelected
                      ? member?.statusDotColor || 'bg-zinc-500'
                      : 'bg-zinc-300'
                  }`}
                />

                {/* Model Name */}
                <span className={`pr-1.5 select-none ${!isSelected ? 'text-zinc-400' : ''}`}>
                  {member?.name || id}
                </span>

                {/* Touch / Hybrid Pointer: Explicit Reorder Chevron (Right/Later) */}
                <button
                  type="button"
                  onClick={(e) => handleSwap(e, idx + 1)}
                  disabled={idx === seatOrder.length - 1 || isDebating}
                  aria-label={`Move ${member?.name || id} later`}
                  className="panel-touch-reorder p-1.5 min-w-[36px] min-h-[36px] text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200/60 transition-colors disabled:opacity-0 disabled:pointer-events-none cursor-pointer items-center justify-center"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>

                {/* Dedicated Action Button: X (active) / + (inactive) */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleModel(id);
                  }}
                  aria-label={isSelected ? `Remove ${member?.name || id} from panel` : `Add ${member?.name || id} to panel`}
                  className={`p-1 pl-1.5 pr-1.5 [@media(any-pointer:coarse)]:p-2 [@media(any-pointer:coarse)]:min-w-[36px] [@media(any-pointer:coarse)]:min-h-[36px] border-l border-zinc-200/70 rounded-r-md transition-colors cursor-pointer flex items-center justify-center ${
                    isSelected 
                      ? 'text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100/80' 
                      : 'text-zinc-400 hover:text-emerald-600 hover:bg-emerald-50'
                  }`}
                  title={isSelected ? `Remove ${member?.name || id}` : `Add ${member?.name || id}`}
                >
                  {isSelected ? (
                    <X className="w-3 h-3 [@media(any-pointer:coarse)]:w-3.5 [@media(any-pointer:coarse)]:h-3.5 text-zinc-400 group-hover:text-zinc-600 hover:!text-zinc-900" />
                  ) : (
                    <Plus className="w-3 h-3 [@media(any-pointer:coarse)]:w-3.5 [@media(any-pointer:coarse)]:h-3.5 text-zinc-400 hover:text-emerald-600" />
                  )}
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
            <div className="council-inline-only hidden items-center gap-1.5 text-xs font-medium text-amber-900 bg-amber-50 px-2.5 py-0.5 rounded-md border border-amber-200/70">
              <Loader2 className="w-3 h-3 animate-spin text-amber-700" />
              <span>Responding...</span>
            </div>
          )}
        </div>
      </div>

      {/* COMPACT MODE: Vertical Panel Configuration Dropdown Panel */}
      {isMobilePanelOpen && (
        <div
          id="council-panel"
          ref={panelRef}
          role="dialog"
          aria-labelledby="council-trigger"
          className="council-compact-only council-panel-dropdown flex flex-col absolute top-full left-[max(4.125rem,calc(env(safe-area-inset-left)+3.375rem))] nav-rail:left-[max(1.5rem,env(safe-area-inset-left))] mt-1.5 max-h-[calc(100dvh-4rem)] overflow-y-auto p-2 bg-white rounded-2xl border border-zinc-200/90 shadow-xl z-30 animate-in fade-in zoom-in-95 duration-150 space-y-1.5"
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
                className={`flex items-center justify-between px-2.5 py-1 rounded-xl border transition-colors select-none min-h-[44px] ${
                  isSpeaking
                    ? 'bg-amber-50 text-zinc-800 border-amber-300 shadow-2xs'
                    : isSelected
                    ? 'bg-zinc-50 text-zinc-700 border-zinc-200/80'
                    : 'bg-white text-zinc-400 border-zinc-200/50 opacity-50'
                }`}
              >
                {/* Left: Status Dot & Model Name */}
                <div className="flex items-center gap-2 min-w-0 pr-2 flex-1">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      isSpeaking
                        ? 'bg-amber-500 animate-pulse'
                        : isSelected
                        ? member?.statusDotColor || 'bg-zinc-500'
                        : 'bg-zinc-300'
                    }`}
                  />
                  <span className={`text-xs font-medium truncate ${!isSelected ? 'text-zinc-400' : 'text-zinc-700'}`}>
                    {member?.name || id}
                  </span>
                </div>

                {/* Right: Side-by-side Reorder Controls & Action Button in Fixed Geometry */}
                <div className="flex items-center gap-1 shrink-0">
                  {/* Fixed-size two-direction reorder control slot */}
                  <div className="flex items-center gap-0.5 bg-zinc-100/80 rounded-lg p-0.5">
                    {/* Up Swap Button (Slot preserved across all rows) */}
                    <button
                      type="button"
                      onClick={(e) => handleSwap(e, idx - 1)}
                      disabled={idx === 0 || isDebating}
                      aria-label={`Move ${member?.name || id} earlier`}
                      className="w-7 h-7 [@media(any-pointer:coarse)]:w-9 [@media(any-pointer:coarse)]:h-9 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-white active:bg-zinc-200/70 transition-colors disabled:opacity-20 disabled:pointer-events-none cursor-pointer flex items-center justify-center target-secondary"
                      title={idx === 0 ? undefined : `Move ${member?.name || id} earlier`}
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>

                    {/* Down Swap Button (Slot preserved across all rows) */}
                    <button
                      type="button"
                      onClick={(e) => handleSwap(e, idx + 1)}
                      disabled={idx === seatOrder.length - 1 || isDebating}
                      aria-label={`Move ${member?.name || id} later`}
                      className="w-7 h-7 [@media(any-pointer:coarse)]:w-9 [@media(any-pointer:coarse)]:h-9 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-white active:bg-zinc-200/70 transition-colors disabled:opacity-20 disabled:pointer-events-none cursor-pointer flex items-center justify-center target-secondary"
                      title={idx === seatOrder.length - 1 ? undefined : `Move ${member?.name || id} later`}
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Dedicated Action Button: X (active) / + (inactive) */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleModel(id);
                    }}
                    aria-label={isSelected ? `Remove ${member?.name || id} from panel` : `Add ${member?.name || id} to panel`}
                    className={`w-8 h-8 [@media(any-pointer:coarse)]:w-9 [@media(any-pointer:coarse)]:h-9 rounded-lg border transition-colors cursor-pointer flex items-center justify-center target-secondary ${
                      isSelected 
                        ? 'text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 border-transparent hover:border-zinc-200' 
                        : 'text-zinc-400 hover:text-emerald-600 hover:bg-emerald-50 border-zinc-200/60'
                    }`}
                    title={isSelected ? `Remove ${member?.name || id}` : `Add ${member?.name || id}`}
                  >
                    {isSelected ? (
                      <X className="w-3.5 h-3.5 text-zinc-500 hover:text-zinc-800" />
                    ) : (
                      <Plus className="w-3.5 h-3.5 text-zinc-400 hover:text-emerald-600" />
                    )}
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
