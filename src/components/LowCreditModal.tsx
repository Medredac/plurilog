'use client';

import React from 'react';
import { OutOfCreditsModal } from './OutOfCreditsModal';

interface LowCreditModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LowCreditModal: React.FC<LowCreditModalProps> = ({
  isOpen,
  onClose,
}) => (
  <OutOfCreditsModal
    isOpen={isOpen}
    onClose={onClose}
    variant="low"
  />
);
