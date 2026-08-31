'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Sidebar } from '../../components/Sidebar';
import { CouncilHeader } from '../../components/CouncilHeader';
import { ChatFeed } from '../../components/ChatFeed';
import { ChatInput } from '../../components/ChatInput';
import { OutOfCreditsModal } from '../../components/OutOfCreditsModal';
import { LowCreditModal } from '../../components/LowCreditModal';
import { AccountSettingsModal } from '../../components/AccountSettingsModal';
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
  const params = useParams();
  const urlDiscussionId = params?.discussionId as string | undefined;
  const hasInitializedRef = useRef(false);
  const isNewlyCreatedDiscussionRef = useRef(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [debates, setDebates] = useState<DebateTopic[]>([]);
  const [activeDebateId, setActiveDebateId] = useState<string | null>(null);
  const activeDebateIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentFetchIdRef = useRef<string | null>(null);

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
  const [isOutOfCredits, setIsOutOfCredits] = useState(false);
  const [userPlan, setUserPlan] = useState<'free' | 'paid'>('free');
  const [remainingCents, setRemainingCents] = useState<number>(0);
  const [periodResetAt, setPeriodResetAt] = useState<string | null>(null);
  const [showLowCreditModal, setShowLowCreditModal] = useState(false);
  const hasShownLowCreditRef = useRef(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [isAccountSettingsOpen, setIsAccountSettingsOpen] = useState(false);
  const [restoreDraft, setRestoreDraft] = useState<{ text: string; trigger: number } | null>(null);
  const [userEmail, setUserEmail] = useState<string | undefined>(undefined);
  const [userDisplayName, setUserDisplayName] = useState<string | undefined>(undefined);
  const [userAvatarUrl, setUserAvatarUrl] = useState<string | undefined>(undefined);
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

  // Fetch messages for a specific discussion and populate canvas atomically
  const fetchDiscussionMessages = useCallback(async (discussionId: string, isInitialMount: boolean = false) => {
    if (!discussionId) {
      setMessages([]);
      setCanContinue(false);
      return;
    }

    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
      fetchTimeoutRef.current = null;
    }

    currentFetchIdRef.current = discussionId;

    // For initial mount without existing content, or slow fetch (>400ms), show spinner
    if (isInitialMount) {
      setIsLoadingMessages(true);
    } else {
      fetchTimeoutRef.current = setTimeout(() => {
        setIsLoadingMessages(true);
      }, 400);
    }

    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('discussion_id', discussionId)
        .order('created_at', { ascending: true });

      // If another discussion was selected in the meantime, ignore stale result
      if (currentFetchIdRef.current !== discussionId) {
        return;
      }

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
          image_url: m.image_url || null,
          likes: 0,
          isStreaming: false,
        };
      });

      console.log(`[Supabase Success] Loaded ${formatted.length} messages for discussion ${discussionId}`);

      // Atomic swap: update discussion ID, messages, and state together once data arrives
      activeDebateIdRef.current = discussionId;
      setActiveDebateId(discussionId);
      setMessages(formatted);
      setCanContinue(formatted.length > 0);
      setErrorMessage(null);
      setSeatStatuses(INITIAL_SEAT_STATUSES);
      setIsDebating(false);
      setActiveSpeaker(null);
    } catch (err) {
      if (currentFetchIdRef.current === discussionId) {
        console.error('[Supabase Exception] fetchDiscussionMessages exception:', err);
        setMessages([]);
        setCanContinue(false);
      }
    } finally {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
        fetchTimeoutRef.current = null;
      }
      if (currentFetchIdRef.current === discussionId) {
        setIsLoadingMessages(false);
      }
    }
  }, [supabase]);

  // Check user's current credit balance from database and update isOutOfCredits state
  const refreshCreditStatus = useCallback(async () => {
    try {
      const { data: balanceRows, error } = await supabase.rpc('get_my_balance');
      const balance = balanceRows?.[0];
      if (!error && balance) {
        const remaining = Number(balance.remaining_cents);
        setIsOutOfCredits(remaining <= 0);
        setUserPlan(balance.plan === 'paid' ? 'paid' : 'free');
        setRemainingCents(remaining);

        if (
          balance.plan !== 'paid' &&
          remaining > 0 &&
          remaining <= 25 &&
          !hasShownLowCreditRef.current
        ) {
          hasShownLowCreditRef.current = true;
          setShowLowCreditModal(true);
        }

        const { data: { user: freshUser } } = await supabase.auth.getUser();
        if (freshUser) {
          const { data: profileRow } = await supabase
            .from('profiles')
            .select('period_reset_at')
            .eq('id', freshUser.id)
            .single();
          setPeriodResetAt(profileRow?.period_reset_at || null);
        }
      }
    } catch (err) {
      console.error('[Credit Check] Failed to refresh balance:', err);
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
        const metadata = session.user?.user_metadata;
        setUserDisplayName(metadata?.display_name || metadata?.full_name || undefined);
        setUserAvatarUrl(metadata?.avatar_url || undefined);
        refreshCreditStatus();

        if (!hasInitializedRef.current) {
          hasInitializedRef.current = true;
          await fetchDiscussions(session.user.id);
          if (urlDiscussionId) {
            activeDebateIdRef.current = urlDiscussionId;
            setActiveDebateId(urlDiscussionId);
            await fetchDiscussionMessages(urlDiscussionId, true);
          }
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
        const metadata = session.user?.user_metadata;
        setUserDisplayName(metadata?.display_name || metadata?.full_name || undefined);
        setUserAvatarUrl(metadata?.avatar_url || undefined);
        refreshCreditStatus();
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [router, supabase, fetchDiscussions, fetchDiscussionMessages, urlDiscussionId, refreshCreditStatus]);

  // Handle browser back/forward buttons with pushState routing
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      const match = path.match(/\/dashboard\/(.+)/);
      if (match && match[1]) {
        const discId = match[1];
        fetchDiscussionMessages(discId, false);
      } else if (path === '/dashboard' || path === '/dashboard/') {
        if (fetchTimeoutRef.current) {
          clearTimeout(fetchTimeoutRef.current);
          fetchTimeoutRef.current = null;
        }
        currentFetchIdRef.current = null;
        activeDebateIdRef.current = null;
        setActiveDebateId(null);
        setMessages([]);
        setCanContinue(false);
        setSeatStatuses(INITIAL_SEAT_STATUSES);
        setIsDebating(false);
        setActiveSpeaker(null);
        setIsLoadingMessages(false);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
      }
    };
  }, [fetchDiscussionMessages]);

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
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
      fetchTimeoutRef.current = null;
    }
    currentFetchIdRef.current = null;
    activeDebateIdRef.current = null;
    setActiveDebateId(null);
    setMessages([]);
    setErrorMessage(null);
    setSeatStatuses(INITIAL_SEAT_STATUSES);
    setIsDebating(false);
    setActiveSpeaker(null);
    setCanContinue(false);
    setIsLoadingMessages(false);
    window.history.pushState(null, '', '/dashboard');
  };

  // Select existing discussion, update URL, and load its messages atomically
  const handleSelectDebate = (id: string) => {
    if (activeDebateId === id && !isDebating) return;
    window.history.pushState(null, '', `/dashboard/${id}`);
    fetchDiscussionMessages(id, false);
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
      // Find and delete any attached images in storage for this discussion
      const { data: imgMessages, error: imgFetchErr } = await supabase
        .from('messages')
        .select('image_url')
        .eq('discussion_id', id)
        .not('image_url', 'is', null);

      console.log(`[Image Cleanup] Found ${imgMessages?.length || 0} image messages for discussion ${id}`);

      if (imgFetchErr) {
        console.error('[Supabase Error] Error fetching images for discussion deletion:', imgFetchErr, { discussion_id: id });
      } else if (imgMessages && imgMessages.length > 0) {
        const filePaths: string[] = [];
        for (const row of imgMessages) {
          if (!row.image_url) continue;
          const bucketIndex = row.image_url.indexOf('message-images/');
          if (bucketIndex !== -1) {
            const rawPath = row.image_url.slice(bucketIndex + 'message-images/'.length).split('?')[0];
            const decodedPath = decodeURIComponent(rawPath);
            if (decodedPath) {
              filePaths.push(decodedPath);
            }
          }
        }

        console.log('[Image Cleanup] Extracted file paths:', filePaths);

        if (filePaths.length > 0) {
          const { data: storageRemoveData, error: storageRemoveErr } = await supabase.storage
            .from('message-images')
            .remove(filePaths);

          console.log('[Image Cleanup] Storage remove() returned:', storageRemoveData);

          if (storageRemoveErr) {
            console.error('[Supabase Error] Error removing discussion images from storage:', storageRemoveErr, { filePaths });
          }
        }
      }

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
    isContinueRound?: boolean,
    imageUrl?: string | null
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
          imageUrl: imageUrl || null,
        }),
      });

      if (!response.ok) {
        let errDetails = `HTTP Error ${response.status}`;
        let errCode: string | undefined;
        try {
          const errJson = await response.json();
          if (errJson.error) {
            errDetails = errJson.error;
          }
          if (errJson.code) {
            errCode = errJson.code;
          }
        } catch {
          // ignore
        }
        const err = new Error(errDetails);
        (err as any).code = errCode;
        throw err;
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
          if (err?.code === 'INSUFFICIENT_CREDITS') {
            setIsOutOfCredits(true);
            setShowUpgradeModal(true);
            setRestoreDraft({ text: promptToSend, trigger: Date.now() });
          } else {
            setErrorMessage(
              err?.message ||
                'Failed to connect to relay. Please check OPENROUTER_API_KEY in .env.local.'
            );
          }
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
      refreshCreditStatus();
    }
  };

  // Triggered when user submits a new prompt
  const handleSendMessage = async (content: string, imageFile?: File) => {
    const activeSeatOrder = seatOrder.filter((id) => activeModels.includes(id));
    if (isDebating || (!content.trim() && !imageFile) || !userId || activeSeatOrder.length === 0) return;

    if (isOutOfCredits) {
      setShowUpgradeModal(true);
      return;
    }

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

    // Temporary local blob URL for instant optimistic display without waiting for storage upload
    const tempImageUrl = imageFile ? URL.createObjectURL(imageFile) : null;
    const tempUserMsgId = `msg-user-${Date.now()}`;
    const userMsg: ChatMessage = {
      id: tempUserMsgId,
      discussionId: currentDiscussionId || undefined,
      role: 'user',
      authorName: 'You',
      content: content,
      timestamp: nowTimeStr,
      image_url: tempImageUrl,
    };

    // Instant optimistic UI update: immediately append user message to chat
    setMessages((prev) => [...prev, userMsg]);

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
          window.history.pushState(null, '', `/dashboard/${newDisc.id}`);

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

    // 2. Handle image upload to Supabase Storage in background if present
    let realSignedUrl: string | null = null;
    if (imageFile) {
      try {
        const filePath = `${userId}/${Date.now()}-${imageFile.name}`;
        const { error: uploadError } = await supabase.storage
          .from('message-images')
          .upload(filePath, imageFile);

        if (uploadError) {
          console.error('[Supabase Storage Error] Upload failed:', uploadError);
          // Rollback optimistic message on failure
          setMessages((prev) => prev.filter((m) => m.id !== tempUserMsgId));
          if (tempImageUrl) URL.revokeObjectURL(tempImageUrl);
          setErrorMessage('Failed to upload file. Please try again.');
          setIsDebating(false);
          return;
        }

        const { data: signedData, error: signError } = await supabase.storage
          .from('message-images')
          .createSignedUrl(filePath, 259200); // 72 hours

        if (signError || !signedData?.signedUrl) {
          console.error('[Supabase Storage Error] Failed to generate signed URL:', signError);
          // Rollback optimistic message on failure
          setMessages((prev) => prev.filter((m) => m.id !== tempUserMsgId));
          if (tempImageUrl) URL.revokeObjectURL(tempImageUrl);
          setErrorMessage('Failed to process file. Please try again.');
          setIsDebating(false);
          return;
        }

        realSignedUrl = signedData.signedUrl;

        // Replace temporary object URL with real signed URL and revoke object URL
        setMessages((prev) =>
          prev.map((m) => (m.id === tempUserMsgId ? { ...m, image_url: realSignedUrl } : m))
        );
        if (tempImageUrl) URL.revokeObjectURL(tempImageUrl);
      } catch (err: any) {
        console.error('[Supabase Storage Exception]', err);
        // Rollback optimistic message on failure
        setMessages((prev) => prev.filter((m) => m.id !== tempUserMsgId));
        if (tempImageUrl) URL.revokeObjectURL(tempImageUrl);
        setErrorMessage('Failed to upload file. Please try again.');
        setIsDebating(false);
        return;
      }
    }

    // 3. Persist user message to Supabase messages table
    if (currentDiscussionId) {
      try {
        const { data: insertedUserMsg, error: insertUserErr } = await supabase.from('messages').insert({
          discussion_id: currentDiscussionId,
          sender: 'user',
          content: content,
          image_url: realSignedUrl,
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

    // 4. Trigger sequential AI relay
    if (currentDiscussionId) {
      await runRelay(content, currentDiscussionId, activeSeatOrder, false, realSignedUrl);
    }
  };

  // Triggered when user clicks "Continue Discussion" button
  const handleContinue = async () => {
    const activeSeatOrder = seatOrder.filter((id) => activeModels.includes(id));
    if (isDebating || !activeDebateId || !userId || activeSeatOrder.length === 0) return;

    if (isOutOfCredits) {
      setShowUpgradeModal(true);
      return;
    }

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
    await runRelay('', activeDebateId, activeSeatOrder, true, null);
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
        userDisplayName={userDisplayName}
        userAvatarUrl={userAvatarUrl}
        userPlan={userPlan}
        onOpenAccountSettings={() => setIsAccountSettingsOpen(true)}
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
          isOutOfCredits={isOutOfCredits}
          isLowCredit={userPlan === 'free' && remainingCents > 0 && remainingCents <= 25}
          onUpgradeClick={async () => {
            try {
              const res = await fetch('/api/stripe/checkout', { method: 'POST' });
              const data = await res.json();
              if (data.url) {
                window.location.href = data.url;
              }
            } catch (err) {
              console.error('[Header Upgrade] Failed to start checkout:', err);
            }
          }}
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
              {/* Brand Logo (Substantially Enlarged ~2.5x with subtle drop-in) */}
              <div 
                className="w-24 h-24 mb-5 flex items-center justify-center animate-drop-fade"
                style={{ animationDelay: '0ms' }}
              >
                <img
                  src="/logo.svg"
                  alt="Plurilog"
                  className="w-20 h-20 sm:w-22 sm:h-22"
                />
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
                  restoreDraft={restoreDraft}
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
            restoreDraft={restoreDraft}
          />
        )}
      </main>

      {/* Out of Credits Upgrade Modal */}
      <OutOfCreditsModal
        isOpen={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
      />

      {/* Low Credit Warning Modal */}
      <LowCreditModal
        isOpen={showLowCreditModal}
        onClose={() => setShowLowCreditModal(false)}
      />

      {/* Account Settings Modal */}
      <AccountSettingsModal
        isOpen={isAccountSettingsOpen}
        onClose={() => setIsAccountSettingsOpen(false)}
        displayName={userDisplayName || userEmail || 'User'}
        userEmail={userEmail}
        userAvatarUrl={userAvatarUrl}
        userPlan={userPlan}
        onNameUpdated={(newName) => setUserDisplayName(newName)}
        periodResetAt={periodResetAt}
      />
    </div>
  );
}
