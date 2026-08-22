import { CouncilMember, DebateTopic } from '../types/chat';

export const COUNCIL_MEMBERS: Record<string, CouncilMember> = {
  'gemini': {
    id: 'gemini',
    apiModelId: 'google/gemini-3.7-flash',
    name: 'Gemini',
    shortName: 'Gemini',
    statusDotColor: 'bg-blue-500',
    status: 'Ready',
  },
  'claude': {
    id: 'claude',
    apiModelId: '~anthropic/claude-sonnet-latest',
    name: 'Claude',
    shortName: 'Claude',
    statusDotColor: 'bg-amber-500',
    status: 'Ready',
  },
  'chatgpt': {
    id: 'chatgpt',
    apiModelId: 'openai/gpt-5.6-luna',
    name: 'ChatGPT',
    shortName: 'ChatGPT',
    statusDotColor: 'bg-emerald-500',
    status: 'Ready',
  },
};

// Clean empty array - real discussions and messages will be fetched directly from Supabase
export const MOCK_DEBATES: DebateTopic[] = [];

export const PROMPT_SUGGESTIONS = [
  {
    title: 'Mars Colonization vs Deep Ocean',
    prompt: 'Should humanity allocate $500B to establishing a permanent Mars colony or exploring 100% of Earth’s ocean floor?',
  },
  {
    title: 'AI Qualia & Consciousness',
    prompt: 'Will transformer architectures ever achieve subjective qualia, or are they fundamentally philosophical zombies?',
  },
  {
    title: 'Rust vs TypeScript in 2030',
    prompt: 'In 2030, will full-stack software development be dominated by WebAssembly in Rust or will TypeScript retain the web standard?',
  },
];
