'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { COUNCIL_MEMBERS } from '../data/mockDebates';
import { ModelId } from '../types/chat';
import { ProviderBadge } from './ProviderBadge';

interface AiSeatsControlProps {
  seatOrder: ModelId[];
  activeModels: ModelId[];
  onReorderSeats: (newOrder: ModelId[]) => void;
  onToggleModel: (id: ModelId) => void;
  disabled?: boolean;
  onInteract?: () => void;
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
  onInteract,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [draggedId, setDraggedId] = useState<ModelId | null>(null);
  const [dragOverId, setDragOverId] = useState<ModelId | null>(null);
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
    if (
      disabled ||
      fromIndex === toIndex ||
      toIndex < 0 ||
      toIndex >= seatOrder.length
    ) {
      return;
    }

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
    setDragOverId(null);
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
        data-seat-toggle="true"
        draggable={false}
        aria-checked={isActive}
        aria-label={`${isActive ? 'Switch off' : 'Switch on'} ${COUNCIL_MEMBERS[id]?.name || id}`}
        disabled={disabled || isLastActive}
        onPointerDown={(event) => event.stopPropagation()}
        onDragStart={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation();
          onToggleModel(id);
        }}
        className={`relative flex h-11 w-11 sm:h-[22px] sm:w-[40px] shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D9D6CF] focus-visible:ring-offset-2 ${
          disabled || isLastActive
            ? 'cursor-not-allowed opacity-55'
            : 'cursor-pointer'
        }`}
      >
        <span
          className={`relative block h-[26px] w-11 sm:h-[22px] sm:w-[40px] rounded-full transition-colors duration-200 ${
            isActive ? 'bg-[#1C1B1A]' : 'bg-[#D9D6CF]'
          }`}
        >
          <motion.span
            className="absolute left-[2px] top-[2px] block h-[22px] w-[22px] sm:h-[18px] sm:w-[18px] rounded-full bg-white"
            animate={{ x: isActive ? 18 : 0 }}
            transition={{ type: 'spring', stiffness: 520, damping: 34, mass: 0.55 }}
          />
        </span>
      </button>
    );
  };

  return (
    <div ref={rootRef} className="relative z-30 self-start">
      <button
        type="button"
        onClick={() => {
          if (!disabled) {
            onInteract?.();
            setIsOpen((prev) => !prev);
          }
        }}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className={`inline-flex h-11 sm:h-9 items-center gap-1.5 rounded-[14px] sm:rounded-[10px] border bg-white px-2.5 text-[13px] font-medium text-[#1C1B1A] transition-all ${
          isOpen
            ? 'border-[#D9D6CF] ring-2 ring-[#E7E5E0]/70'
            : 'border-[#E2E0DB] hover:border-[#D9D6CF] hover:bg-[#F7F6F3]'
        } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
      >
        <span className="flex items-center overflow-visible">
          {seatOrder.map((id) => {
            const isActive = activeSet.has(id);

            return (
              <motion.span
                key={id}
                initial={false}
                animate={{
                  width: isActive ? 18 : 0,
                  opacity: isActive ? 1 : 0,
                }}
                transition={{
                  width: { duration: 0.2, ease: 'easeInOut' },
                  opacity: { duration: isActive ? 0.18 : 0.12, ease: 'easeOut' },
                }}
                className="relative h-6 shrink-0 overflow-visible"
                aria-hidden={!isActive}
              >
                <span className="absolute left-0 top-[-3px]">
                  <ProviderBadge provider={id} size="sm" />
                </span>
              </motion.span>
            );
          })}
        </span>

        <span className="relative inline-flex min-w-[36px] overflow-hidden">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={countLabel}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
            >
              {countLabel}
            </motion.span>
          </AnimatePresence>
        </span>
        <span className="text-[#D9D6CF]">·</span>
        <span className="text-[#6A675F]">Edit</span>

        <ChevronDown
          className={`h-3 w-3 text-[#8A867D] transition-transform ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <>
          {/* Desktop: anchored drop-up */}
          <div
            role="dialog"
            aria-label="Who’s in this chat"
            className="absolute bottom-full left-0 mb-2 hidden w-[336px] rounded-[14px] border border-[#E2E0DB] bg-white p-1.5 text-left dashboard-menu-shadow sm:block"
          >
            <div className="px-3 pt-2.5 pb-2 text-left">
              <h3 className="text-left text-base font-semibold leading-6 text-[#1C1B1A]">
                Who’s in this chat
              </h3>
              <p className="mt-1 text-left text-xs leading-5 text-[#6A675F]">
                Switch an AI off to take it out of the conversation. Drag to reorder.
              </p>
            </div>

            <div className="space-y-1">
              {seatOrder.map((id) => {
                const member = COUNCIL_MEMBERS[id];
                const isActive = activeSet.has(id);
                const isDragging = draggedId === id;
                const isDragTarget = dragOverId === id && draggedId !== id;

                return (
                  <motion.div
                    key={id}
                    layout="position"
                    transition={{ type: 'tween', duration: 0.25, ease: 'easeInOut' }}
                    draggable={!disabled}
                    onDragStart={(event: any) => {
                      const target = event.target as HTMLElement;
                      if (target.closest('[data-seat-toggle="true"]')) {
                        event.preventDefault();
                        return;
                      }

                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', id);
                      setDraggedId(id);
                      setDragOverId(null);
                    }}
                    onDragOver={(event: any) => {
                      event.preventDefault();
                      if (!draggedId || draggedId === id) return;
                      event.dataTransfer.dropEffect = 'move';
                      setDragOverId(id);
                    }}
                    onDragLeave={() => {
                      if (dragOverId === id) setDragOverId(null);
                    }}
                    onDrop={(event: any) => {
                      event.preventDefault();
                      moveDraggedSeat(id);
                    }}
                    onDragEnd={() => {
                      setDraggedId(null);
                      setDragOverId(null);
                    }}
                    className={`flex min-h-[56px] items-center gap-2 rounded-xl px-2.5 py-1.5 select-none transition-[background-color,box-shadow,opacity] ${
                      disabled
                        ? 'cursor-not-allowed'
                        : 'cursor-grab active:cursor-grabbing'
                    } ${
                      isActive
                        ? 'bg-white hover:bg-[#F7F6F3]'
                        : 'bg-[#F7F6F3] hover:bg-[#EFEDE9]'
                    } ${isDragging ? 'opacity-45' : ''} ${
                      isDragTarget
                        ? 'ring-2 ring-[#D9D6CF] ring-offset-1 ring-offset-white'
                        : ''
                    }`}
                    title={disabled ? undefined : `Drag ${member?.name || id} to reorder`}
                  >
                    <span
                      className="flex h-8 w-5 shrink-0 items-center justify-center text-[#B9B5AC] pointer-events-none"
                      aria-hidden="true"
                    >
                      <GripVertical className="h-4 w-4" />
                    </span>

                    <ProviderBadge provider={id} size="sm" className="pointer-events-none" />

                    <div className="min-w-0 flex-1 text-left pointer-events-none">
                      <div
                        className={`truncate text-[15px] font-medium leading-5 ${
                          isActive ? 'text-[#1C1B1A]' : 'text-[#6A675F]'
                        }`}
                      >
                        {member?.name || id}
                      </div>
                      <div className="text-[11px] leading-4 text-[#8A867D]">
                        {isActive ? 'Answering' : 'Sitting out'}
                      </div>
                    </div>

                    {renderToggle(id)}
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* Mobile: bottom sheet */}
          <div
            className="fixed inset-0 z-[80] sm:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="AI seats"
          >
            <button
              type="button"
              aria-label="Close AI seats"
              className="absolute inset-0 h-full w-full bg-[rgba(28,27,26,0.38)] backdrop-blur-[1px]"
              onClick={() => setIsOpen(false)}
            />

            <div className="absolute inset-x-0 bottom-0 rounded-t-[24px] border-t border-[#E2E0DB] bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 text-left dashboard-menu-shadow">
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[#D9D6CF]" />

              <div className="px-1 text-left">
                <h3 className="text-left text-[20px] font-semibold tracking-tight text-[#1C1B1A]">
                  AI seats
                </h3>
                <p className="mt-1 max-w-[360px] text-left text-[14px] leading-5 text-[#6A675F]">
                  AIs answer in this order. Switch one off to take it out of the chat.
                </p>
              </div>

              <div className="mt-3 space-y-2">
                {seatOrder.map((id, index) => {
                  const member = COUNCIL_MEMBERS[id];
                  const isActive = activeSet.has(id);
                  const position = activePosition(id);
                  const isLastActive = isActive && activeCount === 1;

                  return (
                    <motion.div
                      key={id}
                      layout="position"
                      transition={{ type: 'tween', duration: 0.25, ease: 'easeInOut' }}
                      className={`flex min-h-16 items-center gap-2 rounded-[14px] px-2.5 py-2 ${
                        isActive ? 'bg-[#F7F6F3]' : 'bg-white'
                      }`}
                    >
                      <span className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                        isActive ? 'bg-[#1C1B1A] text-white' : 'bg-[#ECEAE5] text-[#8A867D]'
                      }`}>
                        {isActive ? position : '–'}
                      </span>

                      <ProviderBadge provider={id} size="sm" />

                      <div className="min-w-0 flex-1 text-left">
                        <div
                          className={`truncate text-[15px] font-medium leading-5 ${
                            isActive ? 'text-[#1C1B1A]' : 'text-[#6A675F]'
                          }`}
                        >
                          {member?.name || id}
                        </div>
                        <div className="text-[11px] leading-4 text-[#8A867D]">
                          {isActive
                            ? `Answers ${ordinal(position)}${isLastActive ? ' · keep at least one' : ''}`
                            : 'Off, not in this chat'}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => moveSeat(index, index - 1)}
                        disabled={disabled || index === 0}
                        aria-label={`Move ${member?.name || id} earlier`}
                        className="flex h-11 w-10 items-center justify-center rounded-[10px] border border-[#E2E0DB] bg-white text-[#6A675F] transition-colors hover:bg-[#F7F6F3] disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => moveSeat(index, index + 1)}
                        disabled={disabled || index === seatOrder.length - 1}
                        aria-label={`Move ${member?.name || id} later`}
                        className="flex h-11 w-10 items-center justify-center rounded-[10px] border border-[#E2E0DB] bg-white text-[#6A675F] transition-colors hover:bg-[#F7F6F3] disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>

                      {renderToggle(id)}
                    </motion.div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="mt-4 flex h-[52px] w-full items-center justify-center rounded-[14px] bg-[#1C1B1A] text-sm font-medium text-white transition-colors hover:bg-[#2A2927] active:bg-black"
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
