'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Sidebar } from '../../components/Sidebar';
import { CouncilHeader } from '../../components/CouncilHeader';
import { ChatFeed, FailedTurnState } from '../../components/ChatFeed';
import { ChatInput } from '../../components/ChatInput';
import { OutOfCreditsModal } from '../../components/OutOfCreditsModal';
import { LowCreditModal } from '../../components/LowCreditModal';
import { AccountSettingsModal } from '../../components/AccountSettingsModal';
import { PrintableDiscussion } from '../../components/PrintableDiscussion';
import { COUNCIL_MEMBERS } from '../../data/mockDebates';
import { DebateTopic, ModelId, ChatMessage, SeatStatus } from '../../types/chat';
import { ArrowRight, Loader2, ChevronDown, Download, AlertCircle } from 'lucide-react';
import { createClient } from '../../utils/supabase/client';

const INITIAL_SEAT_STATUSES: Record<ModelId, SeatStatus> = {
  'gemini': 'idle',
  'claude': 'idle',
  'chatgpt': 'idle',
};

const DEFAULT_SEAT_ORDER: ModelId[] = [
  'chatgpt',
  'claude',
  'gemini',
];

function validateSeatOrder(raw: unknown): ModelId[] {
  if (!Array.isArray(raw)) {
    return [...DEFAULT_SEAT_ORDER];
  }

  const validIds = new Set<ModelId>(DEFAULT_SEAT_ORDER);
  const seen = new Set<ModelId>();
  const result: ModelId[] = [];

  for (const value of raw) {
    if (
      typeof value === 'string' &&
      validIds.has(value as ModelId) &&
      !seen.has(value as ModelId)
    ) {
      const id = value as ModelId;
      seen.add(id);
      result.push(id);
    }
  }

  for (const id of DEFAULT_SEAT_ORDER) {
    if (!seen.has(id)) {
      result.push(id);
    }
  }

  return result;
}

const CONTINUE_INSTRUCTION =
  "Respond directly to what was just said in the previous round — agree, push back, or add to it, the same way you would in an ongoing conversation.";

interface ActiveDiscussionState {
  controller: AbortController;
  liveSeatMessage: ChatMessage | null;
  seatStatuses: Record<ModelId, SeatStatus>;
  activeSpeaker: ModelId | null;
}

export default function DashboardPage() {
  const router = useRouter();
  const params = useParams();
  const urlDiscussionId = params?.discussionId as string | undefined;
  const hasInitializedRef = useRef(false);
  const isNewlyCreatedDiscussionRef = useRef(false);
  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState(true);
  const [isTransientDrawerOpen, setIsTransientDrawerOpen] = useState(false);
  const [debates, setDebates] = useState<DebateTopic[]>([]);
  const [activeDebateId, setActiveDebateId] = useState<string | null>(null);
  const activeDebateIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeGenerationsRef = useRef<Map<string, ActiveDiscussionState>>(new Map());
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentFetchIdRef = useRef<string | null>(null);
  const retryInFlightRef = useRef(false);

  // Synchronize transient drawer state across breakpoint transitions: reset transient drawer when crossing into desktop (>= 1024px)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const handleBreak = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) {
        setIsTransientDrawerOpen(false);
      }
    };
    if (mq.addEventListener) {
      mq.addEventListener('change', handleBreak);
      return () => mq.removeEventListener('change', handleBreak);
    } else {
      mq.addListener(handleBreak);
      return () => mq.removeListener(handleBreak);
    }
  }, []);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [seatOrder, setSeatOrder] = useState<ModelId[]>([...DEFAULT_SEAT_ORDER]);
  const [activeModels, setActiveModels] = useState<ModelId[]>([
    'gemini',
    'claude',
    'chatgpt',
  ]);
  const [isDebating, setIsDebating] = useState<boolean>(false);
  const [activeSpeaker, setActiveSpeaker] = useState<ModelId | null>(null);
  const [seatStatuses, setSeatStatuses] = useState<Record<ModelId, SeatStatus>>(INITIAL_SEAT_STATUSES);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [failedTurn, setFailedTurn] = useState<FailedTurnState | null>(null);
  const [abandonedFailedTurnIds, setAbandonedFailedTurnIds] = useState<string[]>([]);
  const [isOutOfCredits, setIsOutOfCredits] = useState(false);
  const [userPlan, setUserPlan] = useState<'free' | 'paid'>('free');
  const [remainingCents, setRemainingCents] = useState<number>(0);
  const [periodResetAt, setPeriodResetAt] = useState<string | null>(null);
  const [showLowCreditModal, setShowLowCreditModal] = useState(false);
  const hasShownLowCreditRef = useRef(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [isAccountSettingsOpen, setIsAccountSettingsOpen] = useState(false);
  const [restoreDraft, setRestoreDraft] = useState<{ text: string; files?: File[]; trigger: number } | null>(null);
  const [userEmail, setUserEmail] = useState<string | undefined>(undefined);
  const [userDisplayName, setUserDisplayName] = useState<string | undefined>(undefined);
  const [userAvatarUrl, setUserAvatarUrl] = useState<string | undefined>(undefined);
  const [userId, setUserId] = useState<string | undefined>(undefined);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [canContinue, setCanContinue] = useState<boolean>(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const lastBottomDistanceRef = useRef(0);
  const prevClientHeightRef = useRef<number | null>(null);

  // Observe scrollContainerRef size transitions (keyboard open/close, composer multiline growth, orientation changes)
  // to maintain the Bottom-Anchor Contract when user is at the bottom of the conversation.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    // Reset / initialize state freshly from CURRENT element for this debate
    prevClientHeightRef.current = el.clientHeight;
    const initialDistance = Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
    lastBottomDistanceRef.current = initialDistance;
    isNearBottomRef.current = initialDistance < 80;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const currentHeight = entry.contentRect.height;
        const prevHeight = prevClientHeightRef.current;
        prevClientHeightRef.current = currentHeight;

        // If height changed (e.g. keyboard opened/closed or composer resized) and user was near bottom, restore bottom distance
        if (prevHeight !== null && prevHeight !== currentHeight && isNearBottomRef.current) {
          const maxScroll = Math.max(0, el.scrollHeight - currentHeight);
          const targetScrollTop = Math.min(maxScroll, Math.max(0, el.scrollHeight - currentHeight - lastBottomDistanceRef.current));
          el.scrollTop = targetScrollTop;
        }
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [activeDebateId]);
  const [printExportState, setPrintExportState] = useState<{
    mode: 'discussion' | 'message';
    messages: ChatMessage[];
    title: string;
  } | null>(null);
  const [pendingTitleDiscussionIds, setPendingTitleDiscussionIds] = useState<Set<string>>(new Set());
  const pendingTitleDiscussionIdsRef = useRef<Set<string>>(new Set());
  const titleGenerationStartedIdsRef = useRef<Set<string>>(new Set());

  const markTitlePending = useCallback((discussionId: string) => {
    pendingTitleDiscussionIdsRef.current.add(discussionId);
    setPendingTitleDiscussionIds(new Set(pendingTitleDiscussionIdsRef.current));
  }, []);

  const clearTitlePending = useCallback((discussionId: string) => {
    pendingTitleDiscussionIdsRef.current.delete(discussionId);
    setPendingTitleDiscussionIds(new Set(pendingTitleDiscussionIdsRef.current));
  }, []);

  const supabase = createClient();

  // Print Dialog Lifecycle
  useEffect(() => {
    if (!printExportState) return;

    const originalTitle = document.title;
    const dateStr = new Date().toISOString().slice(0, 10);
    const safeTitle = (printExportState.title || 'Discussion')
      .replace(/[\r\n]+/g, ' ')
      .replace(/[/\\?%*:|"<>]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
    document.title = `Plurilog - ${safeTitle} - ${dateStr}`;

    const handleAfterPrint = () => {
      document.title = originalTitle;
      setPrintExportState(null);
    };

    window.addEventListener('afterprint', handleAfterPrint);

    const timer = setTimeout(() => {
      window.print();
    }, 50);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('afterprint', handleAfterPrint);
      document.title = originalTitle;
    };
  }, [printExportState]);

  const handleTriggerPrint = useCallback(
    (mode: 'discussion' | 'message', targetMessages: ChatMessage[]) => {
      const validMessages = targetMessages.filter(
        (m) => m.content.trim().length > 0 || m.role === 'user'
      );
      if (validMessages.length === 0) return;

      const currentDebate = debates.find((d) => d.id === activeDebateId);
      let title = currentDebate?.title || 'Plurilog Discussion';
      if (title === 'Untitled Discussion' && validMessages[0]?.role === 'user') {
        title = validMessages[0].content.slice(0, 60);
      }
      if (mode === 'message') {
        const msg = validMessages[0];
        const author = msg?.authorName || COUNCIL_MEMBERS[msg?.modelId as ModelId]?.name || 'AI';
        title = `${author} Response - ${title}`;
      }

      setPrintExportState({
        mode,
        messages: validMessages,
        title,
      });
    },
    [debates, activeDebateId]
  );

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
          createdAt: m.created_at || undefined,
          image_url: m.image_url || null,
          attachment_urls: m.attachment_urls || null,
          likes: 0,
          isStreaming: false,
        };
      });

      console.log(`[Supabase Success] Loaded ${formatted.length} messages for discussion ${discussionId}`);

      // Atomic swap: update discussion ID, messages, and state together once data arrives
      activeDebateIdRef.current = discussionId;
      setActiveDebateId(discussionId);

      const activeGen = activeGenerationsRef.current.get(discussionId);
      if (activeGen) {
        const combinedMessages = activeGen.liveSeatMessage
          ? [...formatted, { ...activeGen.liveSeatMessage }]
          : formatted;
        setMessages(combinedMessages);
        setCanContinue(false);
        setErrorMessage(null);
        setFailedTurn(null);
        setAbandonedFailedTurnIds([]);
        setSeatStatuses({ ...activeGen.seatStatuses });
        setIsDebating(true);
        setActiveSpeaker(activeGen.activeSpeaker);
      } else {
        setMessages(formatted);
        setCanContinue(formatted.length > 0);
        setErrorMessage(null);
        setFailedTurn(null);
        setAbandonedFailedTurnIds([]);
        setSeatStatuses(INITIAL_SEAT_STATUSES);
        setIsDebating(false);
        setActiveSpeaker(null);
      }
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

        if (session.user?.id) {
          try {
            const savedRaw = localStorage.getItem(`plurilog-seat-order:${session.user.id}`);
            if (savedRaw) {
              const parsed = JSON.parse(savedRaw);
              setSeatOrder(validateSeatOrder(parsed));
            } else {
              setSeatOrder([...DEFAULT_SEAT_ORDER]);
            }
          } catch (storageErr) {
            console.warn('[Storage Error] Failed to restore seat order preference:', storageErr);
            setSeatOrder([...DEFAULT_SEAT_ORDER]);
          }
        }

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

        if (session.user?.id) {
          try {
            const savedRaw = localStorage.getItem(`plurilog-seat-order:${session.user.id}`);
            if (savedRaw) {
              const parsed = JSON.parse(savedRaw);
              setSeatOrder(validateSeatOrder(parsed));
            } else {
              setSeatOrder([...DEFAULT_SEAT_ORDER]);
            }
          } catch (storageErr) {
            console.warn('[Storage Error] Failed to restore seat order preference:', storageErr);
            setSeatOrder([...DEFAULT_SEAT_ORDER]);
          }
        }
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

  const handleReorderSeats = (newOrder: ModelId[]) => {
    const validatedOrder = validateSeatOrder(newOrder);
    setSeatOrder(validatedOrder);

    if (!userId) {
      return;
    }

    try {
      localStorage.setItem(
        `plurilog-seat-order:${userId}`,
        JSON.stringify(validatedOrder)
      );
    } catch (err) {
      console.warn('[Storage Error] Failed to save seat order:', err);
    }
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
    setFailedTurn(null);
    setAbandonedFailedTurnIds([]);
    setSeatStatuses(INITIAL_SEAT_STATUSES);
    setIsDebating(false);
    setActiveSpeaker(null);
    setCanContinue(false);
    setIsLoadingMessages(false);
    window.history.pushState(null, '', '/dashboard');
    setIsTransientDrawerOpen(false);
  };

  // Select existing discussion, update URL, and load its messages atomically
  const handleSelectDebate = (id: string) => {
    setIsTransientDrawerOpen(false);
    if (activeDebateId === id && !isDebating) return;
    window.history.pushState(null, '', `/dashboard/${id}`);
    fetchDiscussionMessages(id, false);
  };

  // Delete discussion from Supabase and local state
  const handleDeleteDebate = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();

    // Optimistically remove from local state
    setDebates((prev) => prev.filter((d) => d.id !== id));
    clearTitlePending(id);
    titleGenerationStartedIdsRef.current.delete(id);

    if (activeDebateId === id) {
      handleNewDebate();
    }

    try {
      // Find and delete any attached files (images & PDFs) in storage for this discussion
      const { data: attachmentMessages, error: attachmentFetchErr } = await supabase
        .from('messages')
        .select('image_url, attachment_urls')
        .eq('discussion_id', id);

      console.log(`[Attachment Cleanup] Found ${attachmentMessages?.length || 0} messages to inspect for discussion ${id}`);

      if (attachmentFetchErr) {
        console.error('[Supabase Error] Error fetching attachments for discussion deletion:', attachmentFetchErr, { discussion_id: id });
      } else if (attachmentMessages && attachmentMessages.length > 0) {
        const rawUrls: string[] = [];
        for (const row of attachmentMessages) {
          if (row.image_url) {
            rawUrls.push(row.image_url);
          }
          if (Array.isArray(row.attachment_urls)) {
            for (const url of row.attachment_urls) {
              if (url) {
                rawUrls.push(url);
              }
            }
          }
        }

        const filePaths: string[] = [];
        for (const url of rawUrls) {
          const bucketIndex = url.indexOf('message-images/');
          if (bucketIndex !== -1) {
            const rawPath = url.slice(bucketIndex + 'message-images/'.length).split('?')[0];
            const decodedPath = decodeURIComponent(rawPath);
            if (decodedPath && !filePaths.includes(decodedPath)) {
              filePaths.push(decodedPath);
            }
          }
        }

        console.log('[Attachment Cleanup] Extracted file paths:', filePaths);

        if (filePaths.length > 0) {
          const { data: storageRemoveData, error: storageRemoveErr } = await supabase.storage
            .from('message-images')
            .remove(filePaths);

          console.log('[Attachment Cleanup] Storage remove() returned:', storageRemoveData);

          if (storageRemoveErr) {
            console.error('[Supabase Error] Error removing discussion attachments from storage:', storageRemoveErr, { filePaths });
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
    const currentId = activeDebateIdRef.current;
    const activeGen = currentId ? activeGenerationsRef.current.get(currentId) : undefined;
    if (activeGen) {
      activeGen.controller.abort();
      return;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  interface OptimisticPlaceholder {
    firstSeatId: ModelId;
    msgId: string;
  }

  // Executes sequential SSE relay stream for either new user message or continue round
  const runRelay = async (
    promptToSend: string,
    discussionId: string,
    activeSeatOrder: ModelId[],
    isContinueRound?: boolean,
    attachments?: { url: string; filename: string }[] | null,
    sourceUserMessageId?: string | null,
    retrySnapshot?: FailedTurnState | null,
    optimisticPlaceholder?: OptimisticPlaceholder | null,
    existingController?: AbortController | null
  ) => {
    const controller = existingController || new AbortController();
    abortControllerRef.current = controller;
    let inProgressModelId: ModelId | null = null;
    let inProgressContent = '';
    let completedSeatsCount = 0;
    let adoptedFirstSeat = false;
    const currentAttemptModelMsgIds = new Set<string>();

    if (optimisticPlaceholder?.msgId) {
      currentAttemptModelMsgIds.add(optimisticPlaceholder.msgId);
    }

    const initialStatuses: Record<ModelId, SeatStatus> = { ...INITIAL_SEAT_STATUSES };
    activeSeatOrder.forEach((id, index) => {
      initialStatuses[id] = index === 0 ? 'thinking' : 'waiting';
    });

    const nowForLiveSeat = new Date();
    const initialLiveSeatMsg: ChatMessage | null =
      optimisticPlaceholder?.firstSeatId && optimisticPlaceholder?.msgId
        ? {
            id: optimisticPlaceholder.msgId,
            discussionId: discussionId || undefined,
            role: 'model',
            modelId: optimisticPlaceholder.firstSeatId,
            authorName: COUNCIL_MEMBERS[optimisticPlaceholder.firstSeatId]?.name || 'AI',
            content: '',
            timestamp: nowForLiveSeat.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            createdAt: nowForLiveSeat.toISOString(),
            isStreaming: true,
          }
        : null;

    if (discussionId) {
      activeGenerationsRef.current.set(discussionId, {
        controller,
        liveSeatMessage: initialLiveSeatMsg,
        seatStatuses: initialStatuses,
        activeSpeaker: optimisticPlaceholder?.firstSeatId || null,
      });
    }

    if (controller.signal.aborted) {
      if (discussionId) {
        activeGenerationsRef.current.delete(discussionId);
      }
      if (activeDebateIdRef.current === discussionId) {
        setSeatStatuses(INITIAL_SEAT_STATUSES);
        setActiveSpeaker(null);
        setIsDebating(false);
        setCanContinue(true);
        if (optimisticPlaceholder?.msgId) {
          setMessages((prev) => prev.filter((m) => m.id !== optimisticPlaceholder.msgId));
        }
      }
      return;
    }

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
          attachments: attachments || null,
          sourceUserMessageId: sourceUserMessageId || null,
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

      // Helper to launch Title V2 generation at most once per discussion
      const triggerTitleGeneration = (aiSnippet: string) => {
        if (
          !discussionId ||
          !pendingTitleDiscussionIdsRef.current.has(discussionId) ||
          titleGenerationStartedIdsRef.current.has(discussionId)
        ) {
          return;
        }

        titleGenerationStartedIdsRef.current.add(discussionId);

        const titleUserPrompt = (promptToSend || '').trim().slice(0, 300);
        const titleAiResponse = (aiSnippet || '').trim().slice(0, 300);
        const attachmentNames = (attachments || [])
          .map((a) => a.filename)
          .filter(Boolean)
          .slice(0, 5);

        fetch('/api/generate-title', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userPrompt: titleUserPrompt,
            firstAiResponse: titleAiResponse,
            attachmentNames,
            discussionId,
          }),
        })
          .then((res) => res.json())
          .then(async (data) => {
            const generatedTitle = data?.title?.trim();
            if (
              generatedTitle &&
              generatedTitle.toLowerCase() !== 'new discussion' &&
              generatedTitle.toLowerCase() !== 'untitled discussion'
            ) {
              const { error: titleUpdateError } = await supabase
                .from('discussions')
                .update({ title: generatedTitle })
                .eq('id', discussionId);

              if (titleUpdateError) {
                throw titleUpdateError;
              }

              setDebates((prev) =>
                prev.map((d) =>
                  d.id === discussionId ? { ...d, title: generatedTitle } : d
                )
              );
            }
          })
          .catch((titleErr) => {
            console.error('[AI Title Error]', titleErr);
          })
          .finally(() => {
            clearTitlePending(discussionId);
          });
      };

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

              const modelInfo = COUNCIL_MEMBERS[seatId];
              const msgId =
                !adoptedFirstSeat &&
                optimisticPlaceholder &&
                optimisticPlaceholder.firstSeatId === seatId
                  ? optimisticPlaceholder.msgId
                  : `msg-${seatId}-${Date.now()}`;

              if (!adoptedFirstSeat && optimisticPlaceholder && optimisticPlaceholder.firstSeatId !== seatId) {
                currentAttemptModelMsgIds.delete(optimisticPlaceholder.msgId);
              }
              currentAttemptModelMsgIds.add(msgId);
              adoptedFirstSeat = true;

              const nowForSeatMsg = new Date();
              const newMsg: ChatMessage = {
                id: msgId,
                discussionId: discussionId || undefined,
                role: 'model',
                modelId: seatId,
                authorName: modelInfo?.name || data.name || 'AI',
                content: '',
                timestamp: nowForSeatMsg.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                createdAt: nowForSeatMsg.toISOString(),
                isStreaming: true,
              };

              if (discussionId) {
                const activeGen = activeGenerationsRef.current.get(discussionId);
                if (activeGen) {
                  activeGen.liveSeatMessage = { ...newMsg };
                  activeGen.seatStatuses = {
                    ...activeGen.seatStatuses,
                    [seatId]: 'thinking',
                  };
                  activeGen.activeSpeaker = seatId;
                }
              }

              if (isCurrentDiscussionActive) {
                setActiveSpeaker(seatId);
                setSeatStatuses((prev) => ({
                  ...prev,
                  [seatId]: 'thinking',
                }));

                if (optimisticPlaceholder && optimisticPlaceholder.firstSeatId === seatId) {
                  // Adopt the exact optimistic placeholder pre-created at request start
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === optimisticPlaceholder.msgId
                        ? {
                            ...m,
                            discussionId: discussionId || m.discussionId,
                            authorName: modelInfo?.name || data.name || m.authorName,
                          }
                        : m
                    )
                  );
                } else {
                  setMessages((prev) => {
                    const placeholder = optimisticPlaceholder
                      ? prev.find((m) => m.id === optimisticPlaceholder.msgId)
                      : undefined;

                    const isActuallyUnusedPlaceholder = Boolean(
                      placeholder &&
                      placeholder.isStreaming &&
                      !placeholder.content.trim()
                    );

                    if (isActuallyUnusedPlaceholder) {
                      console.warn(
                        `[Plurilog] Seat mismatch: expected initial seat "${optimisticPlaceholder?.firstSeatId}", received "${seatId}". Removing unused placeholder.`
                      );
                    }

                    const base =
                      isActuallyUnusedPlaceholder && optimisticPlaceholder
                        ? prev.filter((m) => m.id !== optimisticPlaceholder.msgId)
                        : prev;

                    return [...base, newMsg];
                  });
                }
              }
            } else if (eventType === 'seat_chunk') {
              const seatId = data.seatId as ModelId;
              const chunk = data.text || '';
              inProgressContent += chunk;

              // If Seat 1 is streaming and has accumulated at least 300 characters, trigger title generation early
              if (
                completedSeatsCount === 0 &&
                inProgressContent.length >= 300 &&
                discussionId &&
                pendingTitleDiscussionIdsRef.current.has(discussionId) &&
                !titleGenerationStartedIdsRef.current.has(discussionId)
              ) {
                triggerTitleGeneration(inProgressContent.slice(0, 300));
              }

              if (discussionId) {
                const activeGen = activeGenerationsRef.current.get(discussionId);
                if (activeGen) {
                  activeGen.seatStatuses = {
                    ...activeGen.seatStatuses,
                    [seatId]: 'speaking',
                  };
                  if (activeGen.liveSeatMessage && activeGen.liveSeatMessage.modelId === seatId) {
                    activeGen.liveSeatMessage = {
                      ...activeGen.liveSeatMessage,
                      content: activeGen.liveSeatMessage.content + chunk,
                    };
                  }
                }
              }

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
              completedSeatsCount++;
              const seatId = data.seatId as ModelId;
              const completedContent = data.content || inProgressContent || '';
              inProgressModelId = null;
              inProgressContent = '';

              if (discussionId) {
                const activeGen = activeGenerationsRef.current.get(discussionId);
                if (activeGen) {
                  activeGen.seatStatuses = {
                    ...activeGen.seatStatuses,
                    [seatId]: 'done',
                  };
                  activeGen.liveSeatMessage = null;
                }
              }

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
                  console.error(
                    `[Supabase Exception] Error persisting message from ${seatId}:`,
                    persistModelErr
                  );
                }
              }

              // If Seat 1 completed and title generation hasn't started yet (e.g. short response < 300 chars), trigger fallback
              if (completedSeatsCount === 1) {
                triggerTitleGeneration(completedContent);
              }
            } else if (eventType === 'council_done') {
              if (discussionId) {
                activeGenerationsRef.current.delete(discussionId);
              }
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
              if (discussionId) {
                activeGenerationsRef.current.delete(discussionId);
                if (
                  completedSeatsCount === 0 &&
                  !titleGenerationStartedIdsRef.current.has(discussionId)
                ) {
                  clearTitlePending(discussionId);
                }
              }
              if (isCurrentDiscussionActive) {
                setIsDebating(false);
                setActiveSpeaker(null);
                setSeatStatuses(INITIAL_SEAT_STATUSES);

                if (completedSeatsCount === 0 && retrySnapshot) {
                  // Zero-output turn failure: clean up placeholders for this attempt and set inline failedTurn state
                  setMessages((prev) => prev.filter((m) => !currentAttemptModelMsgIds.has(m.id)));
                  setFailedTurn(retrySnapshot);
                  setCanContinue(false);
                } else {
                  // Partial-success: preserve successful responses and finalize streaming flags
                  setMessages((prev) =>
                    prev
                      .filter((m) => !currentAttemptModelMsgIds.has(m.id) || m.content.trim().length > 0)
                      .map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
                  );
                  setCanContinue(true);
                }
              }
            }
          } catch (jsonErr) {
            console.error('Error parsing SSE json:', jsonErr, dataStr);
          }
        }
      }
    } catch (err: any) {
      if (discussionId) {
        activeGenerationsRef.current.delete(discussionId);
        if (
          completedSeatsCount === 0 &&
          !titleGenerationStartedIdsRef.current.has(discussionId)
        ) {
          clearTitlePending(discussionId);
        }
      }
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
            prev
              .filter((m) => !currentAttemptModelMsgIds.has(m.id) || m.content.trim().length > 0)
              .map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
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
            setSeatStatuses(INITIAL_SEAT_STATUSES);
            setMessages((prev) => prev.filter((m) => !currentAttemptModelMsgIds.has(m.id)));
          } else if (completedSeatsCount === 0 && retrySnapshot) {
            // Zero-output generation failure: remove placeholders and set inline failedTurn
            setSeatStatuses(INITIAL_SEAT_STATUSES);
            setMessages((prev) => prev.filter((m) => !currentAttemptModelMsgIds.has(m.id)));
            setFailedTurn(retrySnapshot);
            setCanContinue(false);
          } else {
            // Partial-success or fallback without snapshot
            setSeatStatuses(INITIAL_SEAT_STATUSES);
            setMessages((prev) =>
              prev
                .filter((m) => !currentAttemptModelMsgIds.has(m.id) || m.content.trim().length > 0)
                .map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
            );
            setCanContinue(true);
          }
        }
      }
    } finally {
      if (discussionId) {
        activeGenerationsRef.current.delete(discussionId);
      }
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      if (activeDebateIdRef.current === discussionId) {
        setIsDebating(false);
        setActiveSpeaker(null);
      }
      refreshCreditStatus();
    }
  };

  // Triggered when user submits a new prompt
  const handleSendMessage = async (content: string, imageFiles?: File[]) => {
    const activeSeatOrder = seatOrder.filter((id) => activeModels.includes(id));
    if (isDebating || (!content.trim() && (!imageFiles || imageFiles.length === 0)) || !userId || activeSeatOrder.length === 0) return;

    if (isOutOfCredits) {
      setShowUpgradeModal(true);
      setRestoreDraft({ text: content, files: imageFiles, trigger: Date.now() });
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setCanContinue(false);
    setErrorMessage(null);
    if (failedTurn) {
      setAbandonedFailedTurnIds((prev) =>
        prev.includes(failedTurn.uiMessageId)
          ? prev
          : [...prev, failedTurn.uiMessageId]
      );
    }
    setFailedTurn(null);
    setIsDebating(true);

    const firstSeatId = activeSeatOrder[0];
    const initialStatuses: Record<ModelId, SeatStatus> = {
      gemini: 'idle',
      claude: 'idle',
      chatgpt: 'idle',
    };
    activeSeatOrder.forEach((id, index) => {
      initialStatuses[id] = index === 0 ? 'thinking' : 'waiting';
    });
    setSeatStatuses(initialStatuses);
    if (firstSeatId) {
      setActiveSpeaker(firstSeatId);
    }

    // Early snapshot of PDF bytes into stable in-memory ArrayBuffer
    // to avoid iOS/WebKit provider-backed File serialization failures
    type PreparedUploadBody = { file: File; body: File | ArrayBuffer; isPdf: boolean };
    const preparedUploadBodies: PreparedUploadBody[] = [];
    if (imageFiles && imageFiles.length > 0) {
      for (const f of imageFiles) {
        const isPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
        if (isPdf) {
          try {
            const buffer = await f.arrayBuffer();
            if (!buffer || buffer.byteLength === 0) {
              throw new Error('Empty PDF byte buffer');
            }
            preparedUploadBodies.push({ file: f, body: buffer, isPdf: true });
          } catch (readErr) {
            console.error('[PDF Read Error] Failed to read PDF bytes into memory:', readErr, f.name);
            setSeatStatuses(INITIAL_SEAT_STATUSES);
            setActiveSpeaker(null);
            setErrorMessage("Couldn't read that PDF. Please try again.");
            setIsDebating(false);
            setRestoreDraft({ text: content, files: imageFiles, trigger: Date.now() });
            return;
          }
        } else {
          preparedUploadBodies.push({ file: f, body: f, isPdf: false });
        }
      }
    }

    let currentDiscussionId = activeDebateId;
    let newlyCreatedDiscussionId: string | null = null;
    const nowForSend = new Date();
    const nowIso = nowForSend.toISOString();
    const nowTimeStr = nowForSend.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const cleanupNewlyCreatedDiscussion = async () => {
      if (!newlyCreatedDiscussionId) return;
      const orphanId = newlyCreatedDiscussionId;
      newlyCreatedDiscussionId = null;

      // Clean local sidebar, active discussion state, title tracking, and history
      setDebates((prev) => prev.filter((d) => d.id !== orphanId));
      clearTitlePending(orphanId);
      titleGenerationStartedIdsRef.current.delete(orphanId);
      isNewlyCreatedDiscussionRef.current = false;

      if (activeDebateIdRef.current === orphanId) {
        activeDebateIdRef.current = null;
        setActiveDebateId(null);
        window.history.replaceState(null, '', '/dashboard');
      }

      try {
        const { error: delErr } = await supabase
          .from('discussions')
          .delete()
          .eq('id', orphanId);
        if (delErr) {
          console.error('[Supabase Error] Error deleting orphan discussion:', delErr, { orphanId });
        }
      } catch (err) {
        console.error('[Supabase Exception] Error cleaning up orphan discussion:', err, { orphanId });
      }
    };

    // Temporary local blob URLs for instant optimistic display without waiting for storage upload
    // Preserve filename in hash fragment so optimistic URLs immediately render correct document or image cards
    const tempObjectUrls = (imageFiles || []).map(
      (f) => `${URL.createObjectURL(f)}#filename=${encodeURIComponent(f.name)}`
    );
    const tempUserMsgId = `msg-user-${Date.now()}`;
    const userMsg: ChatMessage = {
      id: tempUserMsgId,
      discussionId: currentDiscussionId || undefined,
      role: 'user',
      authorName: 'You',
      content: content,
      timestamp: nowTimeStr,
      createdAt: nowIso,
      image_url: null,
      attachment_urls: tempObjectUrls.length > 0 ? tempObjectUrls : null,
    };

    // Pre-create ONLY the first model seat bubble immediately
    const optimisticFirstModelMsgId = firstSeatId ? `msg-${firstSeatId}-${Date.now()}` : null;
    const initialModelMsg: ChatMessage | null =
      firstSeatId && optimisticFirstModelMsgId
        ? {
            id: optimisticFirstModelMsgId,
            discussionId: currentDiscussionId || undefined,
            role: 'model',
            modelId: firstSeatId,
            authorName: COUNCIL_MEMBERS[firstSeatId]?.name || 'AI',
            content: '',
            timestamp: nowTimeStr,
            createdAt: nowIso,
            isStreaming: true,
          }
        : null;

    // Instant optimistic UI update: immediately append user message and first model thinking placeholder to chat
    setMessages((prev) =>
      initialModelMsg ? [...prev, userMsg, initialModelMsg] : [...prev, userMsg]
    );

    const rollbackOptimistic = () => {
      setMessages((prev) =>
        prev.filter((m) => m.id !== tempUserMsgId && m.id !== optimisticFirstModelMsgId)
      );
      tempObjectUrls.forEach((url) => URL.revokeObjectURL(url.split('#')[0]));
    };

    if (controller.signal.aborted) {
      rollbackOptimistic();
      setSeatStatuses(INITIAL_SEAT_STATUSES);
      setActiveSpeaker(null);
      setIsDebating(false);
      setCanContinue(true);
      return;
    }

    // 1. If no active discussion, create one in Supabase with temporary title, then generate AI summary in parallel
    if (!currentDiscussionId) {
      try {
        const placeholderTitle = 'New discussion';
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
          newlyCreatedDiscussionId = newDisc.id;
          activeDebateIdRef.current = newDisc.id;
          setActiveDebateId(newDisc.id);
          window.history.pushState(null, '', `/dashboard/${newDisc.id}`);

          // Mark newly created discussion ID as pending title generation
          markTitlePending(newDisc.id);

          const newTopic: DebateTopic = {
            id: newDisc.id,
            title: placeholderTitle,
            snippet: content.slice(0, 70) + (content.length > 70 ? '...' : ''),
            createdAt: nowTimeStr,
            updatedAt: nowIso,
            userId: userId,
            participants: ['gemini', 'claude', 'chatgpt'],
            messages: [],
          };
          setDebates((prev) => [newTopic, ...prev]);
        }
      } catch (createErr) {
        console.error('[Supabase Exception] Error initializing discussion:', createErr);
      }

      if (!currentDiscussionId) {
        rollbackOptimistic();
        setSeatStatuses(INITIAL_SEAT_STATUSES);
        setActiveSpeaker(null);
        setErrorMessage('Failed to create discussion. Please try again.');
        setIsDebating(false);
        setRestoreDraft({ text: content, files: imageFiles, trigger: Date.now() });
        return;
      }
    } else {
      // Existing discussion: immediately re-sort to top and update snippet & timestamp
      touchDiscussion(currentDiscussionId, content.slice(0, 70) + (content.length > 70 ? '...' : ''));
    }

    if (controller.signal.aborted) {
      rollbackOptimistic();
      setSeatStatuses(INITIAL_SEAT_STATUSES);
      setActiveSpeaker(null);
      setIsDebating(false);
      setCanContinue(true);
      await cleanupNewlyCreatedDiscussion();
      return;
    }

    // 2. Handle files upload to Supabase Storage in background if present
    const realSignedUrls: string[] = [];
    if (preparedUploadBodies.length > 0) {
      try {
        for (let i = 0; i < preparedUploadBodies.length; i++) {
          if (controller.signal.aborted) {
            rollbackOptimistic();
            setSeatStatuses(INITIAL_SEAT_STATUSES);
            setActiveSpeaker(null);
            setIsDebating(false);
            setCanContinue(true);
            await cleanupNewlyCreatedDiscussion();
            return;
          }

          const { file, body, isPdf } = preparedUploadBodies[i];
          const randomSuffix = Math.random().toString(36).slice(2, 7);
          
          // Generate a strictly controlled ASCII object key to avoid Supabase 400 InvalidKey on Unicode/device filenames
          let safeExt = 'bin';
          if (isPdf) {
            safeExt = 'pdf';
          } else {
            const dotIndex = file.name.lastIndexOf('.');
            if (dotIndex !== -1) {
              const rawExt = file.name.slice(dotIndex + 1).toLowerCase().trim();
              const cleanExt = rawExt.replace(/[^a-z0-9]/g, '').slice(0, 10);
              if (cleanExt) safeExt = cleanExt;
            } else if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
              safeExt = 'jpg';
            } else if (file.type === 'image/png') {
              safeExt = 'png';
            } else if (file.type === 'image/webp') {
              safeExt = 'webp';
            } else if (file.type === 'image/gif') {
              safeExt = 'gif';
            } else if (file.type === 'text/plain') {
              safeExt = 'txt';
            } else if (file.type === 'text/csv') {
              safeExt = 'csv';
            } else if (file.type === 'application/json') {
              safeExt = 'json';
            } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
              safeExt = 'docx';
            }
          }

          const filePath = `${userId}/${Date.now()}-${i}-${randomSuffix}.${safeExt}`;
          const { error: uploadError } = await supabase.storage
            .from('message-images')
            .upload(filePath, body, isPdf ? { contentType: 'application/pdf' } : undefined);

          if (uploadError) {
            console.error('[Supabase Storage Error] Upload failed:', uploadError, {
              fileName: file.name,
              fileSize: file.size,
              fileType: file.type,
              isPdf,
            });

            rollbackOptimistic();
            setSeatStatuses(INITIAL_SEAT_STATUSES);
            setActiveSpeaker(null);
            setErrorMessage('Failed to upload file. Please try again.');
            setIsDebating(false);
            setRestoreDraft({ text: content, files: imageFiles, trigger: Date.now() });
            await cleanupNewlyCreatedDiscussion();
            return;
          }

          const { data: signedData, error: signError } = await supabase.storage
            .from('message-images')
            .createSignedUrl(filePath, 259200); // 72 hours

          if (signError || !signedData?.signedUrl) {
            console.error('[Supabase Storage Error] Failed to generate signed URL:', signError);
            rollbackOptimistic();
            setSeatStatuses(INITIAL_SEAT_STATUSES);
            setActiveSpeaker(null);
            setErrorMessage('Failed to process file. Please try again.');
            setIsDebating(false);
            setRestoreDraft({ text: content, files: imageFiles, trigger: Date.now() });
            await cleanupNewlyCreatedDiscussion();
            return;
          }

          // Preserve the original display filename in the URL hash fragment
          const signedUrlWithFilename = `${signedData.signedUrl}#filename=${encodeURIComponent(file.name)}`;
          realSignedUrls.push(signedUrlWithFilename);
        }

        // Replace temporary object URLs with real signed URLs and revoke object URLs
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempUserMsgId
              ? { ...m, attachment_urls: realSignedUrls.length > 0 ? realSignedUrls : null }
              : m
          )
        );
        tempObjectUrls.forEach((url) => URL.revokeObjectURL(url.split('#')[0]));
      } catch (err: any) {
        console.error('[Supabase Storage Exception]', err);
        rollbackOptimistic();
        setSeatStatuses(INITIAL_SEAT_STATUSES);
        setActiveSpeaker(null);
        setErrorMessage('Failed to upload file. Please try again.');
        setIsDebating(false);
        setRestoreDraft({ text: content, files: imageFiles, trigger: Date.now() });
        await cleanupNewlyCreatedDiscussion();
        return;
      }
    }

    if (controller.signal.aborted) {
      rollbackOptimistic();
      setSeatStatuses(INITIAL_SEAT_STATUSES);
      setActiveSpeaker(null);
      setIsDebating(false);
      setCanContinue(true);
      await cleanupNewlyCreatedDiscussion();
      return;
    }

    // 3. Persist user message to Supabase messages table
    let insertedUserMessageId: string | null = null;
    if (currentDiscussionId) {
      try {
        const { data: insertedUserMsg, error: insertUserErr } = await supabase.from('messages').insert({
          discussion_id: currentDiscussionId,
          sender: 'user',
          content: content,
          attachment_urls: realSignedUrls.length > 0 ? realSignedUrls : null,
        }).select();

        if (insertUserErr) {
          console.error('[Supabase Error] Failed to insert user message:', insertUserErr, {
            discussion_id: currentDiscussionId,
            sender: 'user',
            content: content,
          });
        } else {
          console.log('[Supabase Success] Inserted user message:', insertedUserMsg);
          insertedUserMessageId = insertedUserMsg?.[0]?.id || null;
        }
      } catch (insertUserErr) {
        console.error('[Supabase Exception] Error persisting user message:', insertUserErr);
      }
    }

    if (controller.signal.aborted) {
      if (insertedUserMessageId) {
        if (optimisticFirstModelMsgId) {
          setMessages((prev) => prev.filter((m) => m.id !== optimisticFirstModelMsgId));
        }
      } else {
        rollbackOptimistic();
        await cleanupNewlyCreatedDiscussion();
      }
      setSeatStatuses(INITIAL_SEAT_STATUSES);
      setActiveSpeaker(null);
      setIsDebating(false);
      setCanContinue(true);
      return;
    }

    // 4. Trigger sequential AI relay with retry snapshot
    if (currentDiscussionId) {
      const relayAttachments =
        realSignedUrls.length > 0 && imageFiles
          ? realSignedUrls.map((url, i) => ({
              url,
              filename: imageFiles[i]?.name || 'attachment',
            }))
          : null;

      const retrySnapshot: FailedTurnState | null = insertedUserMessageId
        ? {
            uiMessageId: tempUserMsgId,
            sourceUserMessageId: insertedUserMessageId,
            discussionId: currentDiscussionId,
            prompt: content,
            attachments: relayAttachments,
            seatOrder: activeSeatOrder,
          }
        : null;

      const optimisticPlaceholder =
        firstSeatId && optimisticFirstModelMsgId
          ? { firstSeatId, msgId: optimisticFirstModelMsgId }
          : null;

      await runRelay(
        content,
        currentDiscussionId,
        activeSeatOrder,
        false,
        relayAttachments,
        insertedUserMessageId,
        retrySnapshot,
        optimisticPlaceholder,
        controller
      );
    }
  };

  // Triggered when user clicks "Try again" on an inline failed turn
  const handleRetryTurn = async (snapshot: FailedTurnState) => {
    const retrySeatOrder = snapshot.seatOrder;
    if (
      retryInFlightRef.current ||
      isDebating ||
      !userId ||
      retrySeatOrder.length === 0
    ) {
      return;
    }

    if (isOutOfCredits) {
      setShowUpgradeModal(true);
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const firstSeatId = retrySeatOrder[0];
    retryInFlightRef.current = true;
    setFailedTurn(null);
    setErrorMessage(null);
    setCanContinue(false);
    setIsDebating(true);

    const initialStatuses: Record<ModelId, SeatStatus> = {
      gemini: 'idle',
      claude: 'idle',
      chatgpt: 'idle',
    };
    retrySeatOrder.forEach((id, index) => {
      initialStatuses[id] = index === 0 ? 'thinking' : 'waiting';
    });
    setSeatStatuses(initialStatuses);
    if (firstSeatId) {
      setActiveSpeaker(firstSeatId);
    }

    const nowForRetry = new Date();
    const nowTimeStr = nowForRetry.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const nowIsoStr = nowForRetry.toISOString();
    const optimisticFirstModelMsgId = firstSeatId ? `msg-${firstSeatId}-${Date.now()}` : null;
    const initialModelMsg: ChatMessage | null =
      firstSeatId && optimisticFirstModelMsgId
        ? {
            id: optimisticFirstModelMsgId,
            discussionId: snapshot.discussionId || undefined,
            role: 'model',
            modelId: firstSeatId,
            authorName: COUNCIL_MEMBERS[firstSeatId]?.name || 'AI',
            content: '',
            timestamp: nowTimeStr,
            createdAt: nowIsoStr,
            isStreaming: true,
          }
        : null;

    if (initialModelMsg) {
      setMessages((prev) => [...prev, initialModelMsg]);
    }

    const optimisticPlaceholder =
      firstSeatId && optimisticFirstModelMsgId
        ? { firstSeatId, msgId: optimisticFirstModelMsgId }
        : null;

    try {
      await runRelay(
        snapshot.prompt,
        snapshot.discussionId,
        retrySeatOrder,
        false,
        snapshot.attachments,
        snapshot.sourceUserMessageId,
        snapshot,
        optimisticPlaceholder,
        controller
      );
    } finally {
      retryInFlightRef.current = false;
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

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const firstSeatId = activeSeatOrder[0];
    setCanContinue(false);
    setErrorMessage(null);
    setFailedTurn(null);
    setIsDebating(true);

    const initialStatuses: Record<ModelId, SeatStatus> = {
      gemini: 'idle',
      claude: 'idle',
      chatgpt: 'idle',
    };
    activeSeatOrder.forEach((id, index) => {
      initialStatuses[id] = index === 0 ? 'thinking' : 'waiting';
    });
    setSeatStatuses(initialStatuses);
    if (firstSeatId) {
      setActiveSpeaker(firstSeatId);
    }

    // Re-sort discussion to top immediately
    touchDiscussion(activeDebateId);

    const nowForContinue = new Date();
    const nowTimeStr = nowForContinue.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const nowIsoStr = nowForContinue.toISOString();

    // 1. Insert visible "Continue" user bubble into the conversation (DISPLAY-ONLY)
    const tempUserMsgId = `msg-user-${Date.now()}`;
    const userMsg: ChatMessage = {
      id: tempUserMsgId,
      discussionId: activeDebateId,
      role: 'user',
      authorName: 'You',
      content: 'Continue',
      timestamp: nowTimeStr,
      createdAt: nowIsoStr,
    };

    // Pre-create first model seat placeholder for continue round
    const optimisticFirstModelMsgId = firstSeatId ? `msg-${firstSeatId}-${Date.now()}` : null;
    const initialModelMsg: ChatMessage | null =
      firstSeatId && optimisticFirstModelMsgId
        ? {
            id: optimisticFirstModelMsgId,
            discussionId: activeDebateId,
            role: 'model',
            modelId: firstSeatId,
            authorName: COUNCIL_MEMBERS[firstSeatId]?.name || 'AI',
            content: '',
            timestamp: nowTimeStr,
            createdAt: nowIsoStr,
            isStreaming: true,
          }
        : null;

    setMessages((prev) =>
      initialModelMsg ? [...prev, userMsg, initialModelMsg] : [...prev, userMsg]
    );

    try {
      await supabase.from('messages').insert({
        discussion_id: activeDebateId,
        sender: 'user',
        content: 'Continue',
      });
    } catch (err) {
      console.error('[Supabase Exception] Error persisting continue message:', err);
    }

    if (controller.signal.aborted) {
      if (optimisticFirstModelMsgId) {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticFirstModelMsgId));
      }
      setSeatStatuses(INITIAL_SEAT_STATUSES);
      setActiveSpeaker(null);
      setIsDebating(false);
      setCanContinue(true);
      return;
    }

    const optimisticPlaceholder =
      firstSeatId && optimisticFirstModelMsgId
        ? { firstSeatId, msgId: optimisticFirstModelMsgId }
        : null;

    // 2. Trigger relay with empty string prompt, isContinueRound flag, and optimisticPlaceholder
    await runRelay('', activeDebateId, activeSeatOrder, true, null, null, null, optimisticPlaceholder, controller);
  };

  if (isLoadingAuth) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-white text-zinc-900 font-sans">
        <div className="flex flex-col items-center gap-3">
          <img
            src="/logo.svg"
            alt="Plurilog"
            className="w-8 h-8 rounded-lg object-contain"
          />
          <div className="flex items-center gap-2 text-xs text-zinc-500 font-medium">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-600" />
            <span>Verifying session...</span>
          </div>
        </div>
      </div>
    );
  }

  const displayFirstName = userDisplayName?.trim().split(/\s+/)[0] || '';
  const greetingWords = displayFirstName
    ? ['Hello', `${displayFirstName}!`, 'How', 'can', 'we', 'help?']
    : ['How', 'can', 'we', 'help', 'you', 'today?'];

  return (
    <>
      <div 
        className="flex fixed lg:static inset-x-0 top-0 h-[100dvh] lg:h-screen w-full lg:w-screen overflow-hidden bg-white text-zinc-900 font-sans print:hidden"
      >
        {/* Left Collapsible Sidebar with real fetched discussions and delete action */}
        <Sidebar
          isDesktopOpen={isDesktopSidebarOpen}
          onToggleDesktop={() => setIsDesktopSidebarOpen((prev) => !prev)}
          isDrawerOpen={isTransientDrawerOpen}
          onToggleDrawer={() => setIsTransientDrawerOpen((prev) => !prev)}
          debates={debates}
          activeDebateId={activeDebateId || ''}
          onSelectDebate={handleSelectDebate}
          onNewDebate={handleNewDebate}
          onDeleteDebate={handleDeleteDebate}
          pendingTitleDiscussionIds={pendingTitleDiscussionIds}
          userEmail={userEmail}
          userDisplayName={userDisplayName}
          userAvatarUrl={userAvatarUrl}
          userPlan={userPlan}
          onOpenAccountSettings={() => setIsAccountSettingsOpen(true)}
          onSignOut={handleSignOut}
        />

        {/* Main Chamber */}
        <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-tech-grid min-w-0">
          {/* Simplified Header */}
          <CouncilHeader
            seatOrder={seatOrder}
            onReorderSeats={handleReorderSeats}
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

          {/* Whole Discussion PDF Export Button */}
          {messages.length > 0 && (
            <div className="absolute top-14 lg:top-16 right-[max(1rem,env(safe-area-inset-right))] lg:right-[max(1.5rem,env(safe-area-inset-right))] z-20 pointer-events-none">
              <button
                type="button"
                onClick={() => handleTriggerPrint('discussion', messages)}
                className="pointer-events-auto flex items-center justify-center p-2 rounded-lg bg-white/95 hover:bg-white text-zinc-600 hover:text-zinc-900 border border-zinc-200/90 shadow-2xs hover:shadow-xs transition-all duration-150 cursor-pointer backdrop-blur-xs active:scale-95 animate-in fade-in target-secondary"
                title="Download discussion as PDF"
                aria-label="Download discussion as PDF"
              >
                <Download className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Message Scroll Region Wrapper (Provides stable positioning context for scroll button above variable-height ChatInput) */}
          <div className="relative flex-1 min-h-0 min-w-0 w-full flex flex-col">
            {/* Full-width scrollable viewport / Centered Empty State */}
            <div
              ref={scrollContainerRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                const distanceFromBottom = Math.max(
                  0,
                  el.scrollHeight - el.scrollTop - el.clientHeight
                );
                lastBottomDistanceRef.current = distanceFromBottom;
                isNearBottomRef.current = distanceFromBottom < 80;
                setShowScrollBottom(distanceFromBottom > 120);
              }}
              className="flex-1 min-h-0 min-w-0 overflow-y-auto w-full relative scroll-pt-6 sm:scroll-pt-8 flex flex-col"
            >
              {isLoadingMessages ? (
                <div className="flex flex-col items-center justify-center p-6 text-center h-full min-h-[300px] my-auto">
                  <Loader2 className="w-5 h-5 animate-spin text-zinc-400 mb-2" />
                  <p className="text-xs text-zinc-400">Loading conversation...</p>
                </div>
              ) : messages.length === 0 ? (
                /* Claude-style Clean Centered Empty State with Staggered Entrance Animation */
                <div 
                  key={activeDebateId || 'empty-state-view'}
                  className="flex-1 flex flex-col items-center justify-center pl-[max(clamp(1rem,calc(2vw_+_0.5rem),2rem),env(safe-area-inset-left))] pr-[max(clamp(1rem,calc(2vw_+_0.5rem),2rem),env(safe-area-inset-right))] max-w-3xl mx-auto w-full text-center my-auto pb-12 sm:pb-16"
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
                    {greetingWords.map((word, idx) => (
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
                    {errorMessage && (
                      <div className="p-3.5 mb-4 rounded-xl bg-red-50 border border-red-200/80 text-red-800 text-xs flex items-start gap-2.5 shadow-2xs min-w-0 max-w-full text-left">
                        <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                        <div className="space-y-1 min-w-0">
                          <span className="font-semibold block">Notice</span>
                          <p className="leading-relaxed break-words whitespace-pre-line">{errorMessage}</p>
                        </div>
                      </div>
                    )}
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
                  failedTurn={failedTurn}
                  onRetryTurn={handleRetryTurn}
                  abandonedFailedTurnIds={abandonedFailedTurnIds}
                  onExportMessage={(msg) => handleTriggerPrint('message', [msg])}
                />
              )}
            </div>

            {/* Scroll to Bottom Overlay Button (Anchored directly above ChatInput footer) */}
            {messages.length > 0 && showScrollBottom && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
                <button
                  type="button"
                  onClick={() => {
                    scrollContainerRef.current?.scrollTo({
                      top: scrollContainerRef.current.scrollHeight,
                      behavior: 'smooth',
                    });
                  }}
                  className="pointer-events-auto flex items-center justify-center w-9 h-9 rounded-full bg-white/95 hover:bg-white text-zinc-600 hover:text-zinc-900 border border-zinc-200/90 shadow-md hover:shadow-lg transition-all duration-150 cursor-pointer backdrop-blur-xs active:scale-95 animate-in fade-in zoom-in-95 target-primary"
                  title="Scroll to bottom"
                  aria-label="Scroll to bottom"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
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

      {/* Print Document Root */}
      {printExportState && (
        <PrintableDiscussion
          mode={printExportState.mode}
          messages={printExportState.messages}
          discussionTitle={printExportState.title}
        />
      )}
    </>
  );
}
