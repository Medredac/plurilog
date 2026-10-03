'use client';

import React from 'react';
import { RobotSeatsAnimation } from './RobotSeatsAnimation';

interface AiSeatsCoachmarkProps {
  visible: boolean;
  onDismiss: () => void;
  children: React.ReactNode;
}

export function AiSeatsCoachmark({
  visible,
  onDismiss,
  children,
}: AiSeatsCoachmarkProps) {
  return (
    <div className="relative inline-flex self-start">
      {visible && (
        <div
          role="dialog"
          aria-label="AI seats introduction"
          className="absolute bottom-full left-0 z-[90] mb-5 w-[min(420px,calc(100vw-32px))] rounded-[20px] bg-[#1C1B1A] p-[14px] pb-[18px] text-left shadow-[0_24px_60px_rgba(28,27,26,0.28)]"
        >
          <RobotSeatsAnimation />

          <div className="px-2 pb-1 pt-4">
            <h3 className="text-[17px] font-semibold leading-6 text-white">
              These are your AI seats
            </h3>
            <p className="mt-2 text-[14px] font-normal leading-[1.55] text-[#E4E2DD]">
              You don’t have to use all 3 AIs, or keep them in the same order,
              every time. Open <span className="font-semibold text-white">Edit</span>{' '}
              at any time to add or remove AIs from the discussion, or change
              the order they respond in.
            </p>
            <p className="mt-2 text-[14px] font-medium leading-[1.55] text-white">
              AIs sitting out can pick up the conversation when you bring them back.
            </p>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onDismiss}
                className="inline-flex h-10 items-center justify-center rounded-xl bg-white px-[18px] text-[14px] font-semibold text-[#1C1B1A] transition-colors hover:bg-[#F4F3F0] active:bg-[#ECEAE5]"
              >
                Got it
              </button>
            </div>
          </div>

          <span
            aria-hidden="true"
            className="absolute -bottom-2 left-10 h-4 w-4 rotate-45 bg-[#1C1B1A]"
          />
        </div>
      )}

      <div
        className={
          visible
            ? 'inline-flex rounded-[16px] ring-2 ring-[#E0644B] ring-offset-[3px] ring-offset-white'
            : 'inline-flex'
        }
      >
        {children}
      </div>
    </div>
  );
}
