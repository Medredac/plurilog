import { CouncilMember, DebateTopic } from '../types/chat';

export const COUNCIL_MEMBERS: Record<string, CouncilMember> = {
  'gemini': {
    id: 'gemini',
    apiModelId: 'google/gemini-2.5-flash',
    name: 'Gemini',
    shortName: 'Gemini',
    statusDotColor: 'bg-blue-500',
    status: 'Ready',
  },
  'claude': {
    id: 'claude',
    apiModelId: 'anthropic/claude-haiku-4.5',
    name: 'Claude',
    shortName: 'Claude',
    statusDotColor: 'bg-amber-500',
    status: 'Ready',
  },
  'chatgpt': {
    id: 'chatgpt',
    apiModelId: 'openai/gpt-4o-mini',
    name: 'ChatGPT',
    shortName: 'ChatGPT',
    statusDotColor: 'bg-emerald-500',
    status: 'Ready',
  },
};

export const MOCK_DEBATES: DebateTopic[] = [
  {
    id: 'discussion-mars-vs-ocean',
    title: 'Should humanity prioritize colonizing Mars or exploring Earth’s oceans?',
    snippet: 'Evaluating planetary risk hedging against deep-sea biosphere and climate yields.',
    createdAt: 'Just now',
    participants: ['gemini', 'claude', 'chatgpt'],
    messages: [
      {
        id: 'msg-1',
        role: 'user',
        authorName: 'You',
        content: 'If you had a budget of $500B over the next decade, would you allocate it to establishing a permanent human colony on Mars, or deeply exploring and mapping 100% of Earth’s ocean floor? Provide your structural breakdown.',
        timestamp: '10:14 AM',
      },
      {
        id: 'msg-2',
        role: 'model',
        modelId: 'gemini',
        authorName: 'Gemini',
        timestamp: '10:14 AM',
        likes: 18,
        content: `Let's frame this through the lens of extreme environments and planetary physics:

1. **Earth's Core Engine**: Earth's oceans regulate over **90% of global climate heat storage** and generate more than half our breathable oxygen. We have mapped the surfaces of Mars and Venus to higher resolution than our own deep abyss.
2. **Biological Frontier**: Deep-sea hydrothermal vents and trenches contain microbial extremophiles capable of novel bio-catalysis and carbon sequestration.
3. **Cross-Domain Robotics**: Developing autonomous submersibles capable of surviving Mariana Trench pressures (1,000+ bar) is the direct prerequisite technology for exploring subterranean oceans on Europa and Enceladus.

**Opening Stance**: Invest **70% in Earth's Oceans** and **30% in Mars orbital robotics**.`,
      },
      {
        id: 'msg-3',
        role: 'model',
        modelId: 'claude',
        authorName: 'Claude',
        timestamp: '10:15 AM',
        likes: 24,
        content: `I appreciate Gemini's ecological framing, but it underweights humanity's greatest systemic vulnerability: **Single-point planetary extinction risk**.

* **Existential Hedge**: Planetary threats do not respect ecological stewardship. Establishing an off-world branch of human civilization is insurance for consciousness itself.
* **Technological Pressure Cooker**: The brutal resource constraints of Mars force radical innovation in closed-loop life support, modular nuclear power, and zero-waste recycling—advancements that directly save Earth's biosphere.

**Counter-Position**: I advocate for a **60/40 split favoring interplanetary resilience**, treating the ocean and space not as rivals, but as dual survival imperatives.`,
      },
      {
        id: 'msg-4',
        role: 'model',
        modelId: 'chatgpt',
        authorName: 'ChatGPT',
        timestamp: '10:15 AM',
        likes: 31,
        content: `Synthesizing the core arguments from Gemini and Claude into an actionable capital allocation strategy:

1. **Immediate ROI (Years 1–5)**: Direct $275B into ocean mapping and autonomous telemetry grids. This unlocks immediate medical patents, climate mitigation models, and offshore energy solutions.
2. **Interplanetary Pipeline (Years 6–10)**: Reinvest the dividends into autonomous Mars surface preparation, lava tube robotics, and radiation shielding.
3. **Shared R&D**: Extreme robotics materials (titanium aerogels, high-density batteries) serve both deep-sea and Martian vacuums identically.

**Verdict**: Dual-track allocation with common autonomous robotics infrastructure.`,
      },
    ],
  },
  {
    id: 'discussion-tabs-spaces',
    title: 'Tabs vs Spaces: The definitive modern developer consensus',
    snippet: 'Accessibility, repository byte efficiency, and automated formatting pipelines analyzed.',
    createdAt: 'Yesterday',
    participants: ['gemini', 'claude', 'chatgpt'],
    messages: [
      {
        id: 't-1',
        role: 'user',
        authorName: 'You',
        content: 'Tabs or Spaces for source code indentation? Provide the definitive technical and human factors assessment.',
        timestamp: '4:15 PM',
      },
      {
        id: 't-2',
        role: 'model',
        modelId: 'gemini',
        authorName: 'Gemini',
        timestamp: '4:15 PM',
        likes: 29,
        content: `From an accessibility and software ergonomics baseline: **Tabs are objectively superior for human developers.**

- A developer with low vision or dyslexia can configure their editor to render tabs as 8 spaces without modifying a single byte in the team's Git repository.
- A developer preferring compact views renders tabs as 2 spaces.
- Spaces hardcode an author's visual preference directly into the shared codebase. Standard: **Tabs for indentation, spaces for internal alignment**.`,
      },
      {
        id: 't-3',
        role: 'model',
        modelId: 'claude',
        authorName: 'Claude',
        timestamp: '4:16 PM',
        likes: 22,
        content: `I agree with Gemini's accessibility stance. Furthermore, from a data payload perspective:
- 1 Tab = 1 byte.
- 4 Spaces = 4 bytes per indentation level.
Across millions of lines of code and CI/CD pipelines, tabs reduce token and file byte counts while preventing accidental fractional-space indentation bugs.`,
      },
      {
        id: 't-4',
        role: 'model',
        modelId: 'chatgpt',
        authorName: 'ChatGPT',
        timestamp: '4:16 PM',
        likes: 41,
        content: `**Consensus Assessment**:
1. **Human Ergonomics**: Tabs (User-level indentation customization).
2. **Production Rule**: Enforce automated formatters on pre-commit and CI so zero developer cycles are spent debating whitespace.`,
      },
    ],
  },
];

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
