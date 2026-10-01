'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { COUNCIL_MEMBERS } from '../data/mockDebates';
import { ModelId } from '../types/chat';
import { ProviderIcon } from './ProviderIcon';

interface AiSeatsControlProps {
  seatOrder: ModelId[];
  activeModels: ModelId[];
  onReorderSeats: (newOrder: ModelId[]) => void;
  onToggleModel: (id: ModelId) => void;
  disabled?: boolean;
}

const ordinal = (position: number) => {
  if (position === 1) return 'first';
  if (position === 2) return 'second';
  if (position === 3) return 'third';
  return String(position);
};

export const AiSeatsControl: React.FC<AiSeatsControlProps> = ({
  seatOrder,
  activeModels,
  onReorderSeats,
  onToggleModel,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [draggedId, setDraggedId] = useState<ModelId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const activeSet = useMemo(() => new Set(activeModels), [activeModels]);
  const orderedActive = useMemo(
    () => seatOrder.filter((id) => activeSet.has(id)),
    [seatOrder, activeSet]
  );

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!isOpen || !rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const moveSeat = (fromIndex: number, toIndex: number) => {
    if (disabled || fromIndex === toIndex || toIndex < 0 || toIndex >= seatOrder.length) return;
    const next = [...seatOrder];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    onReorderSeats(next);
  };

  const moveDraggedSeat = (targetId: ModelId) => {
    if (!draggedId || disabled || draggedId === targetId) return;
    const fromIndex = seatOrder.indexOf(draggedId);
    const toIndex = seatOrder.indexOf(targetId);
    if (fromIndex === -1 || toIndex === -1) return;
    moveSeat(fromIndex, toIndex);
    setDraggedId(null);
  };

  const activePosition = (id: ModelId) => orderedActive.indexOf(id) + 1;
  const activeCount = orderedActive.length;
  const countLabel = `${activeCount} ${activeCount === 1 ? 'AI' : 'AIs'}`;

  const renderToggle = (id: ModelId) => {
    const isActive = activeSet.has(id);
    const isLastActive = isActive && activeCount === 1;
    return (
      <button
        type="button"
        role="switch"
        aria-checked={isActive}
        aria-label={`${isActive ? 'Switch off' : 'Switch on'} ${COUNCIL_MEMBERS[id]?.name || id}`}
        disabled={disabled || isLastActive}
        onClick={(event) => {
          event.stopPropagation();
          onToggleModel(id);
        }}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#EAD9AE] focus-visible:ring-offset-2 ${
          isActive ? 'bg-zinc-900' : 'bg-zinc-200'
        } ${disabled || isLastActive ? 'cursor-not-allowed opacity-55' : 'cursor-pointer'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150 ${
            isActive ? 'translate-x-[18px]' : 'translate-x-0.5'
          }`}
        />
      </button>
    );
  };

  return (
    <div ref={rootRef} className="relative z-30 self-start">
      <button
        type="button"
        onClick={() => {
          if (!disabled) setIsOpen((prev) => !prev);
        }}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className={`inline-flex h-8 items-center gap-1.5 rounded-xl border bg-white px-2 text-[11px] font-medium text-zinc-700 shadow-2xs transition-all ${
          isOpen
            ? 'border-[#DCC7A1] ring-2 ring-[#F7E8B8]/45'
            : 'border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50'
        } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
      >
        <span className="flex items-center -space-x-1">
          {orderedActive.map((id) => (
            <span
              key={id}
              className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-white bg-white"
            >
              <ProviderIcon provider={id} className="h-3.5 w-3.5" />
            </span>
          ))}
        </span>
        <span>{countLabel}</span>
        <span className="text-zinc-300">·</span>
        <span className="text-zinc-500">Edit</span>
        <ChevronDown
          className={`h-3 w-3 text-zinc-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <>
          {/* Desktop: anchored drop-up */}
          <div
            role="dialog"
            aria-label="Who’s in this chat"
            className="absolute bottom-full left-0 mb-2 hidden w-[318px] rounded-2xl border border-zinc-200/90 bg-white p-3 text-left shadow-[0_16px_45px_rgba(24,24,27,0.14)] sm:block"
          >
            <div className="px-1 pb-2">
              <h3 className="text-xs font-semibold text-zinc-900">Who’s in this chat</h3>
              <p className="mt-1 text-[10px] leading-4 text-zinc-500">
                Switch an AI off to take it out of the conversation. Drag to reorder.
              </p>
            </div>

            <div className="space-y-1">
              {seatOrder.map((id) => {
                const member = COUNCIL_MEMBERS[id];
                const isActive = activeSet.has(id);
                return (
                  <div
                    key={id}
                    draggable={!disabled}
                    onDragStart={() => setDraggedId(id)}
                    onDragEnd={() => setDraggedId(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => moveDraggedSeat(id)}
                    className={`flex min-h-[48px] items-center gap-2 rounded-xl px-2 py-1.5 transition-colors ${
                      isActive ? 'bg-white' : 'bg-zinc-50'
                    } ${draggedId === id ? 'opacity-45' : ''}`}
                  >
                    <span className="flex h-8 w-5 shrink-0 cursor-grab items-center justify-center text-zinc-300 active:cursor-grabbing" title="Drag to reorder" aria-hidden="true">\n                      <GripVertical className="h-3.5 w-3.5" />\n                    </span>
                    <ProviderIcon provider={id} className="h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className={`truncate text-[13px] font-medium leading-4 ${isActive ? 'text-zinc-800' : 'text-zinc-500'}`}>
                        {member?.name || id}
                      </div>
                      <div className="mt-0.5 text-[10px] leading-3 text-zinc-400">
                        {isActive ? 'Answering' : 'Sitting out'}
                      </div>
                    </div>
                    {renderToggle(id)}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Mobile: bottom sheet */}
          <div className="fixed inset-0 z-[80] sm:hidden" role="dialog" aria-modal="true" aria-label="AI seats">
            <button
              type="button"
              aria-label="Close AI seats"
              className="absolute inset-0 h-full w-full bg-zinc-900/30 backdrop-blur-[1px]"
              onClick={() => setIsOpen(false)}
            />
            <div className="absolute inset-x-0 bottom-0 rounded-t-[22px] border-t border-zinc-200 bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 text-left shadow-[0_-16px_45px_rgba(24,24,27,0.15)]">
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-300" />
              <div className="px-1">
                <h3 className="text-base font-semibold tracking-tight text-zinc-900">AI seats</h3>
                <p className="mt-1 max-w-[310px] text-[11px] leading-4 text-zinc-500">
                  AIs answer in this order. Switch one off to take it out of the chat.
                </p>
              </div>

              <div className="mt-3 space-y-2">
                {seatOrder.map((id, index) => {
                  const member = COUNCIL_MEMBERS[id];
                  const isActive = activeSet.has(id);
                  const position = activePosition(id);
                  return (
                    <div
                      key={id}
                      className={`flex min-h-[52px] items-center gap-2 rounded-xl px-2 py-1.5 ${
                        isActive ? 'bg-zinc-50' : 'bg-zinc-100/80'
                      }`}
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-semibold text-white">
                        {index + 1}
                      </span>
                      <ProviderIcon provider={id} className="h-4 w-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className={`truncate text-[13px] font-medium leading-4 ${isActive ? 'text-zinc-800' : 'text-zinc-500'}`}>
                          {member?.name || id}
                        </div>
                        <div className="mt-0.5 text-[9px] leading-none text-zinc-400">
                          {isActive ? `Answers ${ordinal(position)}` : 'Sitting out'}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => moveSeat(index, index - 1)}
                        disabled={disabled || index === 0}
                        aria-label={`Move ${member?.name || id} earlier`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 shadow-2xs disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveSeat(index, index + 1)}
                        disabled={disabled || index === seatOrder.length - 1}
                        aria-label={`Move ${member?.name || id} later`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 shadow-2xs disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                      {renderToggle(id)}
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="mt-3 flex h-11 w-full items-center justify-center rounded-xl bg-zinc-900 text-xs font-semibold text-white transition-colors hover:bg-zinc-800 active:bg-black"
              >
                Done
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
