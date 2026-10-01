'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
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
  const countLabel = \`\${activeCount} \${activeCount === 1 ? 'AI' : 'AIs'}\`;

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
        aria-label={\`\${isActive ? 'Switch off' : 'Switch on'} \${COUNCIL_MEMBERS[id]?.name || id}\`}
        disabled={disabled || isLastActive}
        onPointerDown={(event) => event.stopPropagation()}
        onDragStart={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation();
          onToggleModel(id);
        }}
        className={\`flex h-[22px] w-[40px] shrink-0 items-center rounded-full p-[2px] transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#EAD9AE] focus-visible:ring-offset-2 \${
          isActive ? 'justify-end bg-zinc-900' : 'justify-start bg-zinc-200'
        } \${
          disabled || isLastActive
            ? 'cursor-not-allowed opacity-55'
            : 'cursor-pointer'
        }\`}
      >
        <span className="block h-[18px] w-[18px] rounded-full bg-white shadow-sm" />
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
        className={\`inline-flex h-8 items-center gap-1.5 rounded-xl border bg-white px-2 text-[11px] font-medium text-zinc-700 shadow-2xs transition-all \${
          isOpen
            ? 'border-[#DCC7A1] ring-2 ring-[#F7E8B8]/45'
            : 'border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50'
        } \${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}\`}
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
          className={\`h-3 w-3 text-zinc-400 transition-transform \${
            isOpen ? 'rotate-180' : ''
          }\`}
        />
      </button>

      {isOpen && (
        <>
          {/* Desktop: anchored drop-up */}
          <div
            role="dialog"
            aria-label="Who’s in this chat"
            className="absolute bottom-full left-0 mb-2 hidden w-[336px] rounded-2xl border border-zinc-200/90 bg-white p-3 text-left shadow-[0_16px_45px_rgba(24,24,27,0.14)] sm:block"
          >
            <div className="px-1 pb-3 text-left">
              <h3 className="text-left text-base font-semibold leading-6 text-zinc-900">
                Who’s in this chat
              </h3>
              <p className="mt-1 text-left text-xs leading-5 text-zinc-500">
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
                    onDragStart={(event) => {
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
                    onDragOver={(event) => {
                      event.preventDefault();
                      if (!draggedId || draggedId === id) return;
                      event.dataTransfer.dropEffect = 'move';
                      setDragOverId(id);
                    }}
                    onDragLeave={() => {
                      if (dragOverId === id) setDragOverId(null);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      moveDraggedSeat(id);
                    }}
                    onDragEnd={() => {
                      setDraggedId(null);
                      setDragOverId(null);
                    }}
                    className={\`flex min-h-[56px] items-center gap-2 rounded-xl px-2.5 py-1.5 select-none transition-[background-color,box-shadow,opacity] \${
                      disabled
                        ? 'cursor-not-allowed'
                        : 'cursor-grab active:cursor-grabbing'
                    } \${
                      isActive
                        ? 'bg-white hover:bg-zinc-50'
                        : 'bg-zinc-50 hover:bg-zinc-100/80'
                    } \${isDragging ? 'opacity-45 shadow-sm' : ''} \${
                      isDragTarget
                        ? 'ring-2 ring-[#EAD9AE] ring-offset-1 ring-offset-white'
                        : ''
                    }\`}
                    title={disabled ? undefined : \`Drag \${member?.name || id} to reorder\`}
                  >
                    <span
                      className="flex h-8 w-5 shrink-0 items-center justify-center text-zinc-300 pointer-events-none"
                      aria-hidden="true"
                    >
                      <GripVertical className="h-4 w-4" />
                    </span>

                    <ProviderIcon provider={id} className="h-4 w-4 shrink-0 pointer-events-none" />

                    <div className="min-w-0 flex-1 text-left pointer-events-none">
                      <div
                        className={\`truncate text-sm font-medium leading-5 \${
                          isActive ? 'text-zinc-800' : 'text-zinc-500'
                        }\`}
                      >
                        {member?.name || id}
                      </div>
                      <div className="text-[11px] leading-4 text-zinc-400">
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
              className="absolute inset-0 h-full w-full bg-zinc-900/30 backdrop-blur-[1px]"
              onClick={() => setIsOpen(false)}
            />

            <div className="absolute inset-x-0 bottom-0 rounded-t-[22px] border-t border-zinc-200 bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 text-left shadow-[0_-16px_45px_rgba(24,24,27,0.15)]">
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-300" />

              <div className="px-1 text-left">
                <h3 className="text-left text-lg font-semibold tracking-tight text-zinc-900">
                  AI seats
                </h3>
                <p className="mt-1 max-w-[330px] text-left text-xs leading-5 text-zinc-500">
                  AIs answer in this order. Switch one off to take it out of the chat.
                </p>
              </div>

              <div className="mt-3 space-y-2">
                {seatOrder.map((id, index) => {
                  const member = COUNCIL_MEMBERS[id];
                  const isActive = activeSet.has(id);
                  const position = activePosition(id);

                  return (
                    <motion.div
                      key={id}
                      layout="position"
                      transition={{ type: 'tween', duration: 0.25, ease: 'easeInOut' }}
                      className={\`flex min-h-[54px] items-center gap-2 rounded-xl px-2 py-1.5 \${
                        isActive ? 'bg-zinc-50' : 'bg-zinc-100/80'
                      }\`}
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-semibold text-white">
                        {index + 1}
                      </span>

                      <ProviderIcon provider={id} className="h-4 w-4 shrink-0" />

                      <div className="min-w-0 flex-1 text-left">
                        <div
                          className={\`truncate text-sm font-medium leading-5 \${
                            isActive ? 'text-zinc-800' : 'text-zinc-500'
                          }\`}
                        >
                          {member?.name || id}
                        </div>
                        <div className="text-[11px] leading-4 text-zinc-400">
                          {isActive
                            ? \`Answers \${ordinal(position)}\`
                            : 'Sitting out'}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => moveSeat(index, index - 1)}
                        disabled={disabled || index === 0}
                        aria-label={\`Move \${member?.name || id} earlier\`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 shadow-2xs transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => moveSeat(index, index + 1)}
                        disabled={disabled || index === seatOrder.length - 1}
                        aria-label={\`Move \${member?.name || id} later\`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 shadow-2xs transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-30"
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
