import { ModelId } from '../types/chat';

export type SeatProvider = 'openai' | 'anthropic' | 'google';

export interface SeatCapabilities {
  seatId: ModelId;
  provider: SeatProvider;
  imageAnalysis: boolean;
  imageGeneration: boolean;
  imageEditing: boolean;
}

/**
 * Authoritative capability metadata per council seat.
 * Reflects genuine provider capabilities without pretending feature parity.
 *
 * NOTE: Inert metadata only — not currently consumed by runtime code.
 */
export const SEAT_CAPABILITIES: Record<ModelId, SeatCapabilities> = {
  chatgpt: {
    seatId: 'chatgpt',
    provider: 'openai',
    imageAnalysis: true,
    imageGeneration: true,
    imageEditing: true,
  },
  claude: {
    seatId: 'claude',
    provider: 'anthropic',
    imageAnalysis: true,
    imageGeneration: false,
    imageEditing: false,
  },
  gemini: {
    seatId: 'gemini',
    provider: 'google',
    imageAnalysis: true,
    imageGeneration: true,
    imageEditing: true,
  },
};

export function getSeatCapabilities(seatId: ModelId): SeatCapabilities {
  return SEAT_CAPABILITIES[seatId];
}
