'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '../../components/Sidebar';
import { CouncilHeader } from '../../components/CouncilHeader';
import { ChatFeed } from '../../components/ChatFeed';
import { ChatInput } from '../../components/ChatInput';
import { COUNCIL_MEMBERS } from '../../data/mockDebates';
import { DebateTopic, ModelId, ChatMessage, SeatStatus } from '../../types/chat';
import { Layers, ArrowRight, Loader2 } from 'lucide-react';
import { createClient } from '../../utils/supabase/client';

const INITIAL_SEAT_STATUSES: Record<ModelId, SeatStatus> = {
  'gemini': 'idle',
  'claude': 'idle',
  'chatgpt': 'idle',
};

const CONTINUE_INSTRUCTION =
  "Respond directly to what was just said in the previous round — agree, push back, or add to it, the same way you would in an ongoing conversation.";

export default function DashboardPage() {
  const router = useRouter();
  const hasInitializedRef = useRef(false);
  const isNewlyCreatedDiscussionRef = useRef(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [debates, setDebates] = useState<DebateTopic[]>([]);
  const [activeDebateId, setActiveDebateId] = useState<string | null>(null);
  const activeDebateIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [seatOrder, setSeatOrder] = useState<ModelId[]>([
    'gemini',
    'claude',
    'chatgpt',
  ]);
  const [activeModels, setActiveModels] = useState<ModelId[]>([
    'gemini',
    'claude',
    'chatgpt',
  ]);
  const [isDebating, setIsDebating] = useState<boolean>(false);
  const [activeSpeaker, setActiveSpeaker] = useState<ModelId | null>(null);
  const [seatStatuses, setSeatStatuses] = useState<Record<ModelId, SeatStatus>>(INITIAL_SEAT_STATUSES);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | undefined>(undefined);
  const [userId, setUserId] = useState<string | undefined>(undefined);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [canContinue, setCanContinue] = useState<boolean>(false);

  const supabase = createClient();

  // Keep activeDebateIdRef synchronized
  useEffect(() => {
    activeDebateIdRef.current = activeDebateId;
  }, [activeDebateId]);

  // Load all discussions for current user ordered by most recent activity (updated_at desc)
  const fetchDiscussions = useCallback(async (uid: string) => {
    try {
      const { data, error } = await supabase
        .from('discussions')
        .select('*')
        .eq('user_id', uid)
        .order('updated_at', { ascending: false, nullsFirst: false });

      if (error) {
        console.error('[Supabase Error] Error fetching discussions:', error, { user_id: uid });
        return [];
      }

      const formatted: DebateTopic[] = (data || []).map((d: any) => {
        const lastActivity = d.updated_at || d.created_at;
        return {
          id: d.id,
          title: d.title || 'Untitled Discussion',
          snippet: d.snippet || '',
          createdAt: lastActivity
            ? new Date(lastActivity).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : 'Just now',
          updatedAt: lastActivity,
          userId: d.user_id,
          participants: ['gemini', 'claude', 'chatgpt'],
          messages: [],
        };
      });

      setDebates(formatted);
      return formatted;
    } catch (err) {
      console.error('[Supabase Exception] fetchDiscussions exception:', err);
      return [];
    }
  }, [supabase]);

  // Helper to touch discussion in DB and re-sort to top of sidebar in real time
  const touchDiscussion = useCallback((discussionId: string, snippet?: string) => {
    const nowIso = new Date().toISOString();
    const nowTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    setDebates((prev) => {
      const idx = prev.findIndex((d) => d.id === discussionId);
      if (idx === -1) return prev;
      const target = prev[idx];
      const updated: DebateTopic = {
        ...target,
        snippet: snippet !== undefined ? snippet : target.snippet,
        createdAt: nowTimeStr,
        updatedAt: nowIso,
      };
      const remainder = prev.filter((d) => d.id !== discussionId);
      return [updated, ...remainder];
    });

    supabase
      .from('discussions')
      .update({ updated_at: nowIso })
      .eq('id', discussionId)
      .then(({ error }) => {
        if (error) {
          console.error('[Supabase Error] Error updating discussion updated_at:', error);
        }
      });
  }, [supabase]);

  // Fetch messages for a specific discussion and populate canvas
  const fetchDiscussionMessages = useCallback(async (discussionId: string) => {
    if (!discussionId) {
      setMessages([]);
      setCanContinue(false);
      return;
    }

    setIsLoadingMessages(true);
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('discussion_id', discussionId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[Supabase Error] Error fetching messages for discussion:', error, { discussion_id: discussionId });
        setMessages([]);
        setCanContinue(false);
        return;
      }

      const formatted: ChatMessage[] = (data || []).map((m: any) => {
        const isUser = m.sender === 'user' || m.role === 'user';
        let modelId: ModelId | undefined = undefined;

        if (!isUser) {
          const senderStr = String(m.sender || m.model_id || 'gemini').toLowerCase();
          if (senderStr.includes('claude') || senderStr.includes('anthropic')) modelId = 'claude';
          else if (senderStr.includes('chatgpt') || senderStr.includes('gpt') || senderStr.includes('openai')) modelId = 'chatgpt';
          else modelId = 'gemini';
        }

        return {
          id: m.id || `msg-${Date.now()}-${Math.random()}`,
          discussionId: m.discussion_id,
          role: isUser ? 'user' : 'model',
          modelId: modelId,
          authorName: isUser ? 'You' : (COUNCIL_MEMBERS[modelId!]?.name || 'AI'),
          content: m.content || m.text || '',
          timestamp: m.created_at
            ? new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '',
          likes: 0,
          isStreaming: false,
        };
      });

      console.log(`[Supabase Success] Loaded ${formatted.length} messages for discussion ${discussionId}`);
      setMessages(formatted);
      setCanContinue(formatted.length > 0);
    } catch (err) {
      console.error('[Supabase Exception] fetchDiscussionMessages exception:', err);
      setMessages([]);
      setCanContinue(false);
    } finally {
      setIsLoadingMessages(false);
    }
  }, [supabase]);

  // Protect route, verify auth, and load discussions once on initial mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          router.replace('/');
          return;
        }
        setUserEmail(session.user?.email);
        setUserId(session.user?.id);

        if (!hasInitializedRef.current) {
          hasInitializedRef.current = true;
          await fetchDiscussions(session.user.id);
        }
      } catch (err) {
        console.error('[Supabase Error] Auth verification error:', err);
        router.replace('/');
      } finally {
        setIsLoadingAuth(false);
      }
    };

    checkAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        router.replace('/');
      } else {
        setUserEmail(session.user?.email);
        setUserId(session.user?.id);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [router, supabase, fetchDiscussions, fetchDiscussionMessages]);

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      router.replace('/');
    } catch (err) {
      console.error('[Supabase Error] Sign out error:', err);
      router.replace('/');
    }
  };

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

  // Reset to fresh blank discussion state without triggering any fetch
  const handleNewDebate = () => {
    activeDebateIdRef.current = null;
    setActiveDebateId(null);
    setMessages([]);
    setErrorMessage(null);
    setSeatStatuses(INITIAL_SEAT_STATUSES);
    setIsDebating(false);
    setActiveSpeaker(null);
    setCanContinue(false);
  };

  // Select existing discussion and load its messages
  const handleSelectDebate = (id: string) => {
    activeDebateIdRef.current = id;
    setActiveDebateId(id);
    setErrorMessage(null);
    setSeatStatuses(INITIAL_SEAT_STATUSES);
    setIsDebating(false);
    setActiveSpeaker(null);
    setCanContinue(false);
    fetchDiscussionMessages(id);
    if (window.innerWidth < 1024) {
      setIsSidebarOpen(false);
    }
  };

  // Delete discussion from Supabase and local state
  const handleDeleteDebate = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();

    // Optimistically remove from local state
    setDebates((prev) => prev.filter((d) => d.id !== id));

    if (activeDebateId === id) {
      handleNewDebate();
    }

    try {
      const { error: msgDelErr } = await supabase.from('messages').delete().eq('discussion_id', id);
      if (msgDelErr) {
        console.error('[Supabase Error] Error deleting messages for discussion:', msgDelErr, { discussion_id: id });
      }
      const { error: discDelErr } = await supabase.from('discussions').delete().eq('id', id);
      if (discDelErr) {
        console.error('[Supabase Error] Error deleting discussion:', discDelErr, { id });
      }
    } catch (err) {
      console.error('[Supabase Exception] Error deleting discussion from Supabase:', err);
    }
  };

  // Stop / Cancel currently in-progress debate relay
  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  // Executes sequential SSE relay stream for either new user message or continue round
  const runRelay = async (
    promptToSend: string,
    discussionId: string,
    activeSeatOrder: ModelId[],
    isContinueRound?: boolean
  ) => {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    let inProgressModelId: ModelId | null = null;
    let inProgressContent = '';

    try {
      const response = await fetch('/api/debate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: promptToSend,
          discussionId: discussionId,
          seatOrder: activeSeatOrder,
          isContinueRound: isContinueRound || false,
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
            const isCurrentDiscussionActive = activeDebateIdRef.current === discussionId;

            if (eventType === 'seat_start') {
              const seatId = data.seatId as ModelId;
              inProgressModelId = seatId;
              inProgressContent = '';

              if (isCurrentDiscussionActive) {
                setActiveSpeaker(seatId);
                setSeatStatuses((prev) => ({
                  ...prev,
                  [seatId]: 'thinking',
                }));

                const modelInfo = COUNCIL_MEMBERS[seatId];
                const newMsg: ChatMessage = {
                  id: `msg-${seatId}-${Date.now()}`,
                  discussionId: discussionId || undefined,
                  role: 'model',
                  modelId: seatId,
                  authorName: modelInfo?.name || data.name,
                  content: '',
                  timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  isStreaming: true,
                };

                setMessages((prev) => [...prev, newMsg]);
              }
            } else if (eventType === 'seat_chunk') {
              const seatId = data.seatId as ModelId;
              const chunk = data.text || '';
              inProgressContent += chunk;

              if (isCurrentDiscussionActive) {
                setSeatStatuses((prev) =>
                  prev[seatId] !== 'speaking' ? { ...prev, [seatId]: 'speaking' } : prev
                );

                setMessages((prev) => {
                  const msgs = [...prev];
                  const lastMsgIdx = msgs.findLastIndex((m) => m.modelId === seatId && m.isStreaming);
                  if (lastMsgIdx !== -1) {
                    msgs[lastMsgIdx] = {
                      ...msgs[lastMsgIdx],
                      content: msgs[lastMsgIdx].content + chunk,
                    };
                  }
                  return msgs;
                });
              }
            } else if (eventType === 'seat_done') {
              const seatId = data.seatId as ModelId;
              const completedContent = data.content || inProgressContent || '';
              inProgressModelId = null;
              inProgressContent = '';

              if (isCurrentDiscussionActive) {
                setSeatStatuses((prev) => ({
                  ...prev,
                  [seatId]: 'done',
                }));

                setMessages((prev) =>
                  prev.map((m) =>
                    m.modelId === seatId && m.isStreaming
                      ? { ...m, isStreaming: false, content: completedContent }
                      : m
                  )
                );
              }

              // Persist model response into Supabase messages table (always runs for discussionId)
              if (discussionId && completedContent.trim()) {
                try {
                  const { data: insertedModelMsg, error: insertModelErr } = await supabase.from('messages').insert({
                    discussion_id: discussionId,
                    sender: seatId, // 'gemini' | 'claude' | 'chatgpt'
                    content: completedContent,
                  }).select();

                  if (insertModelErr) {
                    console.error(`[Supabase Error] Failed to insert ${seatId} message:`, insertModelErr, {
                      discussion_id: discussionId,
                      sender: seatId,
                      content: completedContent,
                    });
                  } else {
                    console.log(`[Supabase Success] Inserted ${seatId} message:`, insertedModelMsg);
                  }
                } catch (persistModelErr) {
                  console.error(`[Supabase Exception] Error persisting message from ${seatId}:`, persistModelErr);
                }
              }
            } else if (eventType === 'council_done') {
              if (isCurrentDiscussionActive) {
                setActiveSpeaker(null);
                setIsDebating(false);
                setCanContinue(true); // Allow continuous discussion round!
              }

              // Touch discussion updated_at and move to top of sidebar
              if (discussionId) {
                touchDiscussion(discussionId);
              }
            } else if (eventType === 'error') {
              if (isCurrentDiscussionActive) {
                setErrorMessage(data.message || 'Error occurred during discussion.');
                setIsDebating(false);
                setActiveSpeaker(null);
                setCanContinue(true);
                setMessages((prev) =>
                  prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
                );
              }
            }
          } catch (jsonErr) {
            console.error('Error parsing SSE json:', jsonErr, dataStr);
          }
        }
      }
    } catch (err: any) {
      const isAborted = controller.signal.aborted || err?.name === 'AbortError';

      if (isAborted) {
        console.log('[Relay Stopped] Discussion stream was stopped by user.');

        // If stopped mid-stream, persist whatever partial response was already received
        if (discussionId && inProgressModelId && inProgressContent.trim()) {
          try {
            await supabase.from('messages').insert({
              discussion_id: discussionId,
              sender: inProgressModelId,
              content: inProgressContent.trim(),
            });
          } catch (persistPartialErr) {
            console.error('[Supabase Error] Error persisting partial message on stop:', persistPartialErr);
          }
        }

        if (activeDebateIdRef.current === discussionId) {
          setSeatStatuses(INITIAL_SEAT_STATUSES);
          setActiveSpeaker(null);
          setCanContinue(true);
          setMessages((prev) =>
            prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
          );
        }

        if (discussionId) {
          touchDiscussion(discussionId);
        }
      } else {
        console.error('Error in relay stream:', err);
        if (activeDebateIdRef.current === discussionId) {
          setErrorMessage(
            err?.message ||
              'Failed to connect to relay. Please check OPENROUTER_API_KEY in .env.local.'
          );
          setCanContinue(true);
          setMessages((prev) =>
            prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
          );
        }
      }
    } finally {
      abortControllerRef.current = null;
      if (activeDebateIdRef.current === discussionId) {
        setIsDebating(false);
        setActiveSpeaker(null);
      }
    }
  };

  // Triggered when user submits a new prompt
  const handleSendMessage = async (content: string) => {
    const activeSeatOrder = seatOrder.filter((id) => activeModels.includes(id));
    if (isDebating || !content.trim() || !userId || activeSeatOrder.length === 0) return;

    setCanContinue(false);
    setErrorMessage(null);
    setIsDebating(true);

    const initialStatuses: Record<ModelId, SeatStatus> = {
      gemini: 'idle',
      claude: 'idle',
      chatgpt: 'idle',
    };
    activeSeatOrder.forEach((id) => {
      initialStatuses[id] = 'waiting';
    });
    setSeatStatuses(initialStatuses);

    let currentDiscussionId = activeDebateId;
    const nowIso = new Date().toISOString();
    const nowTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // 1. If no active discussion, create one in Supabase with temporary title, then generate AI summary in parallel
    if (!currentDiscussionId) {
      try {
        const placeholderTitle = content.slice(0, 40).trim() || 'New Discussion';
        const { data: newDisc, error: discErr } = await supabase
          .from('discussions')
          .insert({
            user_id: userId,
            title: placeholderTitle,
            updated_at: nowIso,
          })
          .select()
          .single();

        if (discErr) {
          console.error('[Supabase Error] Error creating discussion in DB:', discErr, { user_id: userId, title: placeholderTitle });
        } else if (newDisc) {
          isNewlyCreatedDiscussionRef.current = true;
          currentDiscussionId = newDisc.id;
          activeDebateIdRef.current = newDisc.id;
          setActiveDebateId(newDisc.id);

          const newTopic: DebateTopic = {
            id: newDisc.id,
            title: newDisc.title,
            snippet: content.slice(0, 70) + (content.length > 70 ? '...' : ''),
            createdAt: nowTimeStr,
            updatedAt: nowIso,
            userId: userId,
            participants: ['gemini', 'claude', 'chatgpt'],
            messages: [],
          };
          setDebates((prev) => [newTopic, ...prev]);

          // In parallel (non-blocking), generate AI title with gemini-3.1-flash-lite and update DB + sidebar
          fetch('/api/generate-title', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: content, discussionId: newDisc.id }),
          })
            .then((res) => res.json())
            .then(async (data) => {
              if (data?.title && data.title !== placeholderTitle) {
                const generatedTitle = data.title;
                // Update local sidebar state
                setDebates((prev) =>
                  prev.map((d) => (d.id === newDisc.id ? { ...d, title: generatedTitle } : d))
                );
                // Update Supabase discussions table
                await supabase
                  .from('discussions')
                  .update({ title: generatedTitle })
                  .eq('id', newDisc.id);
              }
            })
            .catch((titleErr) => {
              console.error('[AI Title Error]', titleErr);
            });
        }
      } catch (createErr) {
        console.error('[Supabase Exception] Error initializing discussion:', createErr);
      }
    } else {
      // Existing discussion: immediately re-sort to top and update snippet & timestamp
      touchDiscussion(currentDiscussionId, content.slice(0, 70) + (content.length > 70 ? '...' : ''));
    }

    // 2. Insert user message locally and into Supabase messages table
    const tempUserMsgId = `msg-user-${Date.now()}`;
    const userMsg: ChatMessage = {
      id: tempUserMsgId,
      discussionId: currentDiscussionId || undefined,
      role: 'user',
      authorName: 'You',
      content: content,
      timestamp: nowTimeStr,
    };

    // Optimistic UI update: instantly append user message
    setMessages((prev) => [...prev, userMsg]);

    if (currentDiscussionId) {
      try {
        const { data: insertedUserMsg, error: insertUserErr } = await supabase.from('messages').insert({
          discussion_id: currentDiscussionId,
          sender: 'user',
          content: content,
        }).select();

        if (insertUserErr) {
          console.error('[Supabase Error] Failed to insert user message:', insertUserErr, {
            discussion_id: currentDiscussionId,
            sender: 'user',
            content: content,
          });
        } else {
          console.log('[Supabase Success] Inserted user message:', insertedUserMsg);
        }
      } catch (insertUserErr) {
        console.error('[Supabase Exception] Error persisting user message:', insertUserErr);
      }
    }

    // 3. Trigger sequential AI relay
    if (currentDiscussionId) {
      await runRelay(content, currentDiscussionId, activeSeatOrder);
    }
  };

  // Triggered when user clicks "Continue Discussion" button
  const handleContinue = async () => {
    const activeSeatOrder = seatOrder.filter((id) => activeModels.includes(id));
    if (isDebating || !activeDebateId || !userId || activeSeatOrder.length === 0) return;

    setCanContinue(false);
    setErrorMessage(null);
    setIsDebating(true);

    const initialStatuses: Record<ModelId, SeatStatus> = {
      gemini: 'idle',
      claude: 'idle',
      chatgpt: 'idle',
    };
    activeSeatOrder.forEach((id) => {
      initialStatuses[id] = 'waiting';
    });
    setSeatStatuses(initialStatuses);

    // Re-sort discussion to top immediately
    touchDiscussion(activeDebateId);

    // 1. Insert visible "Continue" user bubble into the conversation (DISPLAY-ONLY)
    const tempUserMsgId = `msg-user-${Date.now()}`;
    const userMsg: ChatMessage = {
      id: tempUserMsgId,
      discussionId: activeDebateId,
      role: 'user',
      authorName: 'You',
      content: 'Continue',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);

    try {
      await supabase.from('messages').insert({
        discussion_id: activeDebateId,
        sender: 'user',
        content: 'Continue',
      });
    } catch (err) {
      console.error('[Supabase Exception] Error persisting continue message:', err);
    }

    // 2. Trigger relay with empty string prompt and isContinueRound flag
    await runRelay('', activeDebateId, activeSeatOrder, true);
  };

  if (isLoadingAuth) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-white text-zinc-900 font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-900 shadow-2xs">
            <Layers className="w-4 h-4" />
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500 font-medium">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-600" />
            <span>Verifying session...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white text-zinc-900 font-sans">
      {/* Left Collapsible Sidebar with real fetched discussions and delete action */}
      <Sidebar
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
        debates={debates}
        activeDebateId={activeDebateId || ''}
        onSelectDebate={handleSelectDebate}
        onNewDebate={handleNewDebate}
        onDeleteDebate={handleDeleteDebate}
        userEmail={userEmail}
        onSignOut={handleSignOut}
      />

      {/* Main Chamber */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-tech-grid">
        {/* Simplified Header */}
        <CouncilHeader
          seatOrder={seatOrder}
          onReorderSeats={setSeatOrder}
          activeModels={activeModels}
          onToggleModel={handleToggleModel}
          isDebating={isDebating}
          activeSpeaker={activeSpeaker}
          seatStatuses={seatStatuses}
        />

        {/* Full-width scrollable viewport / Centered Empty State */}
        <div className="flex-1 overflow-y-auto w-full relative scroll-pt-6 sm:scroll-pt-8 flex flex-col">
          {isLoadingMessages ? (
            <div className="flex flex-col items-center justify-center p-6 text-center h-full min-h-[300px] my-auto">
              <Loader2 className="w-5 h-5 animate-spin text-zinc-400 mb-2" />
              <p className="text-xs text-zinc-400">Loading conversation...</p>
            </div>
          ) : messages.length === 0 ? (
            /* Claude-style Clean Centered Empty State with Staggered Entrance Animation */
            <div 
              key={activeDebateId || 'empty-state-view'}
              className="flex-1 flex flex-col items-center justify-center px-4 sm:px-8 max-w-3xl mx-auto w-full text-center my-auto pb-12 sm:pb-16"
            >
              {/* Brand Logo in Black (Substantially Enlarged ~2.5x with subtle drop-in) */}
              <div 
                className="w-24 h-24 mb-5 flex items-center justify-center text-black animate-drop-fade"
                style={{ animationDelay: '0ms' }}
              >
                <svg viewBox="0 0 1391 1493" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-20 h-20 sm:w-22 sm:h-22">
                  <path d="M520.475 46.8916C628.765 -15.6299 762.185 -15.6309 870.476 46.8906L1215.95 246.351C1324.24 308.872 1390.95 424.417 1390.95 549.46V948.38C1390.95 1073.42 1324.24 1188.97 1215.95 1251.49L870.476 1450.95C839.295 1468.95 806.031 1481.77 771.884 1489.4V1267.46C771.884 1224.41 793.863 1184.33 830.168 1161.2L1094.26 992.901C1130.56 969.765 1152.54 929.694 1152.54 886.644V583.73C1152.54 538.272 1128.06 496.338 1088.47 473.997L756.024 286.395C716.572 264.132 668.204 264.761 629.344 288.043L319.853 473.464C281.861 496.225 258.609 537.262 258.609 581.55V1299.76L175 1251.49C66.7098 1188.97 0 1073.42 0 948.38V549.46C0.000106195 424.417 66.7099 308.873 175 246.352L520.475 46.8916Z" fill="currentColor"/>
                  <path d="M376.402 536.352L673.55 680.923C691.417 689.616 712.339 689.37 729.998 680.259L1008.92 536.352L731.766 381.638C713.162 371.252 690.568 370.974 671.713 380.899L376.402 536.352Z" fill="currentColor"/>
                  <path d="M766.066 812.685V1103.38L1024.9 937.777C1043 926.198 1053.95 906.195 1053.95 884.71V619.578L799.12 757.258C778.757 768.259 766.066 789.54 766.066 812.685Z" fill="currentColor"/>
                  <path d="M393.853 1372.47L660.466 1492.74V824.821C660.466 801.177 647.227 779.524 626.183 768.747L356.758 630.766V1315.04C356.758 1339.81 371.273 1362.28 393.853 1372.47Z" fill="currentColor"/>
                </svg>
              </div>

              {/* Staggered Drop-Fade Heading Words */}
              <h2 className="text-2xl sm:text-3xl font-semibold text-zinc-900 tracking-tight mb-1.5 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1">
                {['How', 'can', 'we', 'help', 'you', 'today?'].map((word, idx) => (
                  <span
                    key={idx}
                    className="inline-block animate-drop-fade"
                    style={{ animationDelay: `${50 + idx * 45}ms` }}
                  >
                    {word}
                  </span>
                ))}
              </h2>

              {/* Warmer Panel Subtext (Simple Fade-In) */}
              <p 
                className="text-xs sm:text-sm font-normal text-zinc-400 mb-6 animate-simple-fade"
                style={{ animationDelay: '350ms' }}
              >
                Gemini, Claude, and ChatGPT are here to help
              </p>

              {/* Centered Input (Simple Fade-In) */}
              <div 
                className="w-full animate-simple-fade"
                style={{ animationDelay: '420ms' }}
              >
                <ChatInput
                  onSendMessage={handleSendMessage}
                  isLoading={isDebating}
                  onStop={handleStop}
                  isCentered
                  autoFocus
                />
              </div>
            </div>
          ) : (
            <ChatFeed
              messages={messages}
              onPromptClick={handleSendMessage}
              activeSpeaker={activeSpeaker}
              seatStatuses={seatStatuses}
              isDebating={isDebating}
              errorMessage={errorMessage}
              canContinue={canContinue}
              onContinue={handleContinue}
              activeDebateId={activeDebateId}
              isNewlyCreatedRef={isNewlyCreatedDiscussionRef}
            />
          )}
        </div>

        {/* Sticky Input (Only shown once conversation has messages) */}
        {messages.length > 0 && (
          <ChatInput
            onSendMessage={handleSendMessage}
            isLoading={isDebating}
            onStop={handleStop}
            focusTrigger={activeDebateId}
          />
        )}
      </main>
    </div>
  );
}
