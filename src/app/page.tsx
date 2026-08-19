'use client';

import React, { useState } from 'react';
import { Sidebar } from '../components/Sidebar';
import { CouncilHeader } from '../components/CouncilHeader';
import { ChatFeed } from '../components/ChatFeed';
import { ChatInput } from '../components/ChatInput';
import { MOCK_DEBATES, COUNCIL_MEMBERS } from '../data/mockDebates';
import { DebateTopic, ModelId, ChatMessage, SeatStatus } from '../types/chat';
import { Layers, ArrowRight } from 'lucide-react';

const INITIAL_SEAT_STATUSES: Record<ModelId, SeatStatus> = {
  'gemini': 'idle',
  'claude': 'idle',
  'chatgpt': 'idle',
};

export default function PlurilogApp() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [debates, setDebates] = useState<DebateTopic[]>(MOCK_DEBATES);
  const [activeDebateId, setActiveDebateId] = useState<string>(MOCK_DEBATES[0].id);
  const [activeModels, setActiveModels] = useState<ModelId[]>([
    'gemini',
    'claude',
    'chatgpt',
  ]);
  const [isDebating, setIsDebating] = useState<boolean>(false);
  const [activeSpeaker, setActiveSpeaker] = useState<ModelId | null>(null);
  const [seatStatuses, setSeatStatuses] = useState<Record<ModelId, SeatStatus>>(INITIAL_SEAT_STATUSES);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Active discussion object
  const currentDebate = debates.find((d) => d.id === activeDebateId) || debates[0];

  const handleToggleModel = (id: ModelId) => {
    setActiveModels((prev) => {
      if (prev.includes(id)) {
        if (prev.length === 1) return prev;
        return prev.filter((m) => m !== id);
      } else {
        return [...prev, id];
      }
    });
  };

  const handleNewDebate = () => {
    const newId = `discussion-${Date.now()}`;
    const newTopic: DebateTopic = {
      id: newId,
      title: 'New Discussion',
      snippet: 'Type a topic to begin...',
      createdAt: 'Just now',
      participants: ['gemini', 'claude', 'chatgpt'],
      messages: [],
    };

    setDebates([newTopic, ...debates]);
    setActiveDebateId(newId);
    setErrorMessage(null);
    setSeatStatuses(INITIAL_SEAT_STATUSES);
  };

  const handleSelectDebate = (id: string) => {
    setActiveDebateId(id);
    setErrorMessage(null);
    setSeatStatuses(INITIAL_SEAT_STATUSES);
    if (window.innerWidth < 1024) {
      setIsSidebarOpen(false);
    }
  };

  // Real backend sequential relay call via OpenRouter API
  const handleSendMessage = async (content: string) => {
    if (isDebating || !content.trim()) return;

    setErrorMessage(null);

    const userMsg: ChatMessage = {
      id: `msg-user-${Date.now()}`,
      role: 'user',
      authorName: 'You',
      content: content,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const isNew = currentDebate.messages.length === 0;
    const updatedTitle = isNew ? (content.length > 45 ? content.slice(0, 45) + '...' : content) : currentDebate.title;

    // Append user message to active discussion
    setDebates((prev) =>
      prev.map((d) =>
        d.id === activeDebateId
          ? {
              ...d,
              title: updatedTitle,
              snippet: content.slice(0, 80) + '...',
              messages: [...d.messages, userMsg],
            }
          : d
      )
    );

    setIsDebating(true);
    setSeatStatuses({
      'gemini': 'waiting',
      'claude': 'waiting',
      'chatgpt': 'waiting',
    });

    try {
      const response = await fetch('/api/debate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: content,
        }),
      });

      if (!response.ok) {
        let errDetails = `HTTP Error ${response.status}`;
        try {
          const errJson = await response.json();
          if (errJson.error) {
            errDetails = errJson.error;
          }
        } catch {
          // ignore
        }
        throw new Error(errDetails);
      }

      if (!response.body) {
        throw new Error('No response stream received.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const block of lines) {
          if (!block.trim()) continue;

          let eventType = 'message';
          let dataStr = '';

          const eventMatch = block.match(/^event:\s*(.+)$/m);
          if (eventMatch) {
            eventType = eventMatch[1].trim();
          }

          const dataMatch = block.match(/^data:\s*(.+)$/m);
          if (dataMatch) {
            dataStr = dataMatch[1].trim();
          }

          if (!dataStr) continue;

          try {
            const data = JSON.parse(dataStr);

            if (eventType === 'seat_start') {
              const seatId = data.seatId as ModelId;
              setActiveSpeaker(seatId);

              setSeatStatuses((prev) => ({
                ...prev,
                [seatId]: 'speaking',
              }));

              const modelInfo = COUNCIL_MEMBERS[seatId];
              const newMsg: ChatMessage = {
                id: `msg-${seatId}-${Date.now()}`,
                role: 'model',
                modelId: seatId,
                authorName: modelInfo?.name || data.name,
                content: '',
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                isStreaming: true,
              };

              setDebates((prev) =>
                prev.map((d) =>
                  d.id === activeDebateId ? { ...d, messages: [...d.messages, newMsg] } : d
                )
              );
            } else if (eventType === 'seat_chunk') {
              const seatId = data.seatId as ModelId;
              const chunk = data.text || '';

              setDebates((prev) =>
                prev.map((d) => {
                  if (d.id !== activeDebateId) return d;
                  const msgs = [...d.messages];
                  const lastMsgIdx = msgs.findLastIndex((m) => m.modelId === seatId && m.isStreaming);
                  if (lastMsgIdx !== -1) {
                    msgs[lastMsgIdx] = {
                      ...msgs[lastMsgIdx],
                      content: msgs[lastMsgIdx].content + chunk,
                    };
                  }
                  return { ...d, messages: msgs };
                })
              );
            } else if (eventType === 'seat_done') {
              const seatId = data.seatId as ModelId;

              setSeatStatuses((prev) => ({
                ...prev,
                [seatId]: 'done',
              }));

              setDebates((prev) =>
                prev.map((d) => {
                  if (d.id !== activeDebateId) return d;
                  const msgs = d.messages.map((m) =>
                    m.modelId === seatId && m.isStreaming
                      ? { ...m, isStreaming: false, content: data.content || m.content }
                      : m
                  );
                  return { ...d, messages: msgs };
                })
              );
            } else if (eventType === 'council_done') {
              setActiveSpeaker(null);
              setIsDebating(false);
            } else if (eventType === 'error') {
              setErrorMessage(data.message || 'Error occurred during discussion.');
              setIsDebating(false);
              setActiveSpeaker(null);
              setDebates((prev) =>
                prev.map((d) => {
                  if (d.id !== activeDebateId) return d;
                  return {
                    ...d,
                    messages: d.messages.map((m) =>
                      m.isStreaming ? { ...m, isStreaming: false } : m
                    ),
                  };
                })
              );
            }
          } catch (jsonErr) {
            console.error('Error parsing SSE json:', jsonErr, dataStr);
          }
        }
      }
    } catch (err: any) {
      console.error('Error in handleSendMessage:', err);
      setErrorMessage(
        err?.message ||
          'Failed to connect to relay. Please check OPENROUTER_API_KEY in .env.local.'
      );
    } finally {
      setIsDebating(false);
      setActiveSpeaker(null);
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white text-zinc-900 font-sans">
      {/* Left Collapsible Sidebar */}
      <Sidebar
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
        debates={debates}
        activeDebateId={activeDebateId}
        onSelectDebate={handleSelectDebate}
        onNewDebate={handleNewDebate}
      />

      {/* Main Chamber */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-tech-grid">
        {/* Simplified Header */}
        <CouncilHeader
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          activeModels={activeModels}
          onToggleModel={handleToggleModel}
          isDebating={isDebating}
          activeSpeaker={activeSpeaker}
          seatStatuses={seatStatuses}
        />

        {/* Feed */}
        {currentDebate.messages.length === 0 ? (
          /* Empty State */
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto">
            <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-900 shadow-2xs mb-3">
              <Layers className="w-4 h-4" />
            </div>
            <h2 className="font-semibold text-base text-zinc-900 tracking-tight mb-1">
              Start a Discussion
            </h2>
            <p className="text-xs text-zinc-400 mb-6">
              Pose a topic. Gemini, Claude, and ChatGPT will deliberate sequentially.
            </p>

            <div className="grid grid-cols-1 gap-2 w-full text-left">
              <button
                onClick={() => handleSendMessage('Should humanity prioritize colonizing Mars or exploring Earth’s oceans?')}
                className="p-3 rounded-xl bg-white hover:bg-zinc-50/80 border border-zinc-200/70 shadow-sm text-xs transition-colors flex items-center justify-between group cursor-pointer"
              >
                <div>
                  <span className="font-medium text-zinc-900 block">Mars vs Earth Ocean Exploration</span>
                  <span className="text-[11px] text-zinc-400">Capital allocation trade-offs</span>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-700 transition-colors" />
              </button>

              <button
                onClick={() => handleSendMessage('Tabs vs Spaces for modern software indentation standards.')}
                className="p-3 rounded-xl bg-white hover:bg-zinc-50/80 border border-zinc-200/70 shadow-sm text-xs transition-colors flex items-center justify-between group cursor-pointer"
              >
                <div>
                  <span className="font-medium text-zinc-900 block">Tabs vs Spaces</span>
                  <span className="text-[11px] text-zinc-400">Accessibility & tooling consensus</span>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-700 transition-colors" />
              </button>
            </div>
          </div>
        ) : (
          <ChatFeed
            messages={currentDebate.messages}
            onPromptClick={handleSendMessage}
            activeSpeaker={activeSpeaker}
            seatStatuses={seatStatuses}
            isDebating={isDebating}
            errorMessage={errorMessage}
          />
        )}

        {/* Sticky Input */}
        <ChatInput
          onSendMessage={handleSendMessage}
          isLoading={isDebating}
          onSelectSuggestion={(prompt) => handleSendMessage(prompt)}
        />
      </main>
    </div>
  );
}
