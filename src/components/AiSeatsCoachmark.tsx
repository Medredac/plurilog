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
    <div className="relative flex w-full self-start sm:inline-flex sm:w-auto">
      {visible && (
        <div
          role="dialog"
          aria-label="AI seats introduction"
          className="absolute bottom-full left-0 right-0 z-[90] mb-3 rounded-[18px] bg-[#1C1B1A] p-3 pb-3.5 text-left shadow-[0_24px_60px_rgba(28,27,26,0.28)] sm:left-0 sm:right-auto sm:mb-5 sm:w-[420px] sm:rounded-[20px] sm:p-[14px] sm:pb-[18px]"
        >
          <div className="mx-auto w-full max-w-[300px] sm:max-w-none">
            <RobotSeatsAnimation />
          </div>

          <div className="px-1.5 pb-0.5 pt-3 sm:px-2 sm:pb-1 sm:pt-4">
            <h3 className="text-[16px] font-semibold leading-5 text-white sm:text-[17px] sm:leading-6">
              These are your AI seats
            </h3>
            <p className="mt-1.5 text-[13px] font-normal leading-[1.45] text-[#E4E2DD] sm:mt-2 sm:text-[14px] sm:leading-[1.55]">
              You don’t have to use all 3 AIs, or keep them in the same order,
              every time. Open <span className="font-semibold text-white">Edit</span>{' '}
              at any time to add or remove AIs from the discussion, or change
              the order they respond in.
            </p>
            <p className="mt-1.5 text-[13px] font-medium leading-[1.45] text-white sm:mt-2 sm:text-[14px] sm:leading-[1.55]">
              AIs sitting out can pick up the conversation when you bring them back.
            </p>

            <div className="mt-3 flex justify-end sm:mt-4">
              <button
                type="button"
                onClick={onDismiss}
                className="inline-flex h-9 items-center justify-center rounded-[11px] bg-white px-4 text-[13px] font-semibold text-[#1C1B1A] transition-colors hover:bg-[#F4F3F0] active:bg-[#ECEAE5] sm:h-10 sm:rounded-xl sm:px-[18px] sm:text-[14px]"
              >
                Got it
              </button>
            </div>
          </div>

          <span
            aria-hidden="true"
            className="absolute -bottom-2 left-[72px] h-4 w-4 rotate-45 bg-[#1C1B1A] sm:left-10"
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
