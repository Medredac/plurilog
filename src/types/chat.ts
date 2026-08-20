export type ModelId = 'gemini' | 'claude' | 'chatgpt';

export interface CouncilMember {
  id: ModelId;
  apiModelId: string;
  name: string;
  shortName: string;
  statusDotColor: string;
  status: 'Ready' | 'Waiting' | 'Thinking' | 'Speaking' | 'Done';
}

export interface ChatMessage {
  id: string;
  discussionId?: string;
  role: 'user' | 'model';
  modelId?: ModelId;
  authorName?: string;
  content: string;
  timestamp: string;
  likes?: number;
  isConsensusSummary?: boolean;
  isStreaming?: boolean;
}

export interface DebateTopic {
  id: string;
  title: string;
  snippet?: string;
  createdAt: string;
  updatedAt?: string;
  userId?: string;
  participants: ModelId[];
  messages: ChatMessage[];
}

export type SeatStatus = 'idle' | 'waiting' | 'thinking' | 'speaking' | 'done' | 'error';
