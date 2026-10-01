'use client';

import React, { useState, useRef, useEffect } from 'react';
import { 
  Plus, 
  Search, 
  PanelLeftClose, 
  Settings,
  LogOut,
  ChevronUp,
  Trash2,
  MoreVertical,
  Loader2
} from 'lucide-react';
import { DebateTopic } from '../types/chat';
import { createClient } from '../utils/supabase/client';

interface SidebarProps {
  isOpen?: boolean;
  onToggle?: () => void;
  isDesktopOpen?: boolean;
  onToggleDesktop?: () => void;
  isDrawerOpen?: boolean;
  onToggleDrawer?: () => void;
  debates: DebateTopic[];
  activeDebateId: string;
  onSelectDebate: (id: string) => void;
  onNewDebate: () => void;
  onDeleteDebate?: (id: string, e: React.MouseEvent) => void;
  pendingTitleDiscussionIds?: Set<string>;
  userEmail?: string;
  userDisplayName?: string;
  userAvatarUrl?: string;
  userPlan?: 'free' | 'paid';
  onOpenAccountSettings?: () => void;
  onSignOut?: () => void;
  onDeleteProfileClick?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onToggle,
  isDesktopOpen,
  onToggleDesktop,
  isDrawerOpen,
  onToggleDrawer,
  debates,
  activeDebateId,
  onSelectDebate,
  onNewDebate,
  onDeleteDebate,
  pendingTitleDiscussionIds,
  userEmail,
  userDisplayName,
  userAvatarUrl,
  userPlan = 'free',
  onOpenAccountSettings,
  onSignOut,
  onDeleteProfileClick,
}) => {
  const desktopOpen = isDesktopOpen !== undefined ? isDesktopOpen : (isOpen ?? true);
  const drawerOpen = isDrawerOpen !== undefined ? isDrawerOpen : (isOpen ?? false);
  const toggleDesktop = onToggleDesktop || onToggle || (() => {});
  const toggleDrawer = onToggleDrawer || onToggle || (() => {});

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isSearchingDb, setIsSearchingDb] = useState(false);
  const [dbMatchingIds, setDbMatchingIds] = useState<Set<string>>(new Set());
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [menuOpenDebateId, setMenuOpenDebateId] = useState<string | null>(null);
  const [confirmDeleteDebate, setConfirmDeleteDebate] = useState<DebateTopic | null>(null);
  
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownMenuRef = useRef<HTMLDivElement>(null);
  const supabase = useRef(createClient()).current;

  // 1. Debounce search query input by 400ms
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 400);

    return () => {
      clearTimeout(handler);
    };
  }, [searchQuery]);

  // 2. Query messages table for content matches across user discussions
  useEffect(() => {
    if (!debouncedQuery) {
      setDbMatchingIds(new Set());
      setIsSearchingDb(false);
      return;
    }

    let isCancelled = false;
    setIsSearchingDb(true);

    const searchMessages = async () => {
      try {
        const { data, error } = await supabase
          .from('messages')
          .select('discussion_id')
          .ilike('content', `%${debouncedQuery}%`);

        if (error) {
          console.error('[Search Error] Error querying messages content:', error);
          if (!isCancelled) {
            setDbMatchingIds(new Set());
            setIsSearchingDb(false);
          }
          return;
        }

        if (!isCancelled) {
          const ids = new Set<string>(
            (data || []).map((m: any) => m.discussion_id).filter(Boolean)
          );
          setDbMatchingIds(ids);
          setIsSearchingDb(false);
        }
      } catch (err) {
        console.error('[Search Exception] Error querying messages for search:', err);
        if (!isCancelled) {
          setDbMatchingIds(new Set());
          setIsSearchingDb(false);
        }
      }
    };

    searchMessages();

    return () => {
      isCancelled = true;
    };
  }, [debouncedQuery, supabase]);

  // 3. Combined Filter: Title match OR Message Content match from DB
  const queryToMatch = debouncedQuery.toLowerCase();
  const filteredDebates = debates.filter((debate) => {
    if (!queryToMatch) return true;
    const matchesTitle = (debate.title || '').toLowerCase().includes(queryToMatch);
    const matchesContent = dbMatchingIds.has(debate.id);
    return matchesTitle || matchesContent;
  });

  const groupedDebates = (() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
    const weekStart = todayStart - 7 * 24 * 60 * 60 * 1000;

    const groups: Array<{ label: string; items: DebateTopic[] }> = [
      { label: 'Today', items: [] },
      { label: 'Yesterday', items: [] },
      { label: 'Last 7 days', items: [] },
      { label: 'Earlier', items: [] },
    ];

    for (const debate of filteredDebates) {
      const stamp = debate.updatedAt || debate.createdAt;
      const time = stamp ? new Date(stamp).getTime() : Number.NaN;

      if (Number.isNaN(time) || time >= todayStart) groups[0].items.push(debate);
      else if (time >= yesterdayStart) groups[1].items.push(debate);
      else if (time >= weekStart) groups[2].items.push(debate);
      else groups[3].items.push(debate);
    }

    return groups.filter((group) => group.items.length > 0);
  })();

  // Close drop-up menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current && 
        !menuRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setIsProfileMenuOpen(false);
      }

      // Close discussion 3-dot dropdown if click is outside the dropdown container
      if (
        menuOpenDebateId &&
        dropdownMenuRef.current &&
        !dropdownMenuRef.current.contains(event.target as Node)
      ) {
        setMenuOpenDebateId(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isProfileMenuOpen, menuOpenDebateId]);

  const displayName = userDisplayName || userEmail || 'User';
  const firstName = displayName.split(' ')[0];
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <>
      {/* Overlay Backdrop for Mobile & Intermediate Drawers */}
      {drawerOpen && (
        <div
          onClick={toggleDrawer}
          className="absolute inset-0 bg-[rgba(28,27,26,0.38)] backdrop-blur-[1px] z-30 lg:hidden transition-opacity"
        />
      )}

      {/* Compact Floating Trigger (Only rendered on small mobile < 680px when drawer is closed) */}
      {!drawerOpen && (
        <div className="absolute top-2.5 left-[max(0.75rem,env(safe-area-inset-left))] z-30 nav-rail:hidden">
          <button
            type="button"
            onClick={toggleDrawer}
            className="p-2 rounded-lg transition-colors cursor-pointer target-primary flex items-center justify-center"
            title="Open discussions"
            aria-label="Open discussions"
          >
            <img
              src="/logo.svg"
              alt=""
              className="w-4 h-4 object-contain"
            />
          </button>
        </div>
      )}

      {/* Intermediate Persistent 56px Rail (Rendered between 680px and 1023px) */}
      <aside className="hidden nav-rail:flex lg:hidden flex-col justify-between items-center w-14 h-full bg-white border-r border-[#E2E0DB] py-3 shrink-0 z-20 select-none">
        {/* Top Navigation Actions */}
        <div className="flex flex-col items-center gap-3 w-full px-2">
          {/* Plurilog Logo */}
          <button
            type="button"
            onClick={onNewDebate}
            className="p-1.5 rounded-lg flex items-center justify-center hover:bg-zinc-50 transition-colors cursor-pointer target-primary"
            title="Plurilog — New Discussion"
            aria-label="Plurilog — New Discussion"
          >
            <img src="/logo.svg" alt="Plurilog" className="w-6 h-6 rounded-md object-contain" />
          </button>

          {/* New Discussion Button */}
          <button
            type="button"
            onClick={onNewDebate}
            className="p-2 rounded-lg text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 active:bg-zinc-200/60 bg-zinc-50 border border-zinc-200/70 transition-colors cursor-pointer target-primary flex items-center justify-center"
            title="New Discussion"
            aria-label="New Discussion"
          >
            <Plus className="w-4 h-4 text-zinc-600" />
          </button>

          {/* View / Toggle Discussions Drawer Button */}
          <button
            type="button"
            onClick={toggleDrawer}
            className={`p-2 rounded-lg transition-colors cursor-pointer target-primary flex items-center justify-center ${
              drawerOpen
                ? 'bg-zinc-100 text-zinc-800'
                : 'hover:bg-zinc-100 active:bg-zinc-200/60'
            }`}
            title={drawerOpen ? 'Close discussions' : 'All discussions'}
            aria-label={drawerOpen ? 'Close discussions' : 'All discussions'}
          >
            {drawerOpen ? (
              <PanelLeftClose className="w-4 h-4 text-zinc-700" strokeWidth={1.5} />
            ) : (
              <img
                src="/logo.svg"
                alt=""
                className="w-4 h-4 object-contain"
              />
            )}
          </button>
        </div>

        {/* Bottom Profile / Account Trigger */}
        <div className="flex flex-col items-center w-full px-2 relative">
          <button
            type="button"
            onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
            className="w-8 h-8 rounded-full bg-[#D3E0F8] text-[#1C1B1A] flex items-center justify-center font-semibold text-xs border border-white shrink-0 overflow-hidden hover:ring-2 hover:ring-zinc-300 transition-all cursor-pointer target-primary"
            title={`Account (${displayName})`}
            aria-label={`Account (${displayName})`}
          >
            {userAvatarUrl ? (
              <img src={userAvatarUrl} alt={displayName} className="w-full h-full object-cover" />
            ) : (
              initial
            )}
          </button>

          {/* Rail Profile Drop-up Popover */}
          {isProfileMenuOpen && (
            <div
              ref={menuRef}
              className="absolute bottom-full left-2 mb-2 w-60 bg-white rounded-xl border border-[#E2E0DB] dashboard-menu-shadow p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 max-h-[calc(100dvh-5rem)] overflow-y-auto"
            >
              {/* User Profile Header in Menu */}
              <div className="px-2.5 py-2 border-b border-[#E7E5E0] mb-1">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-[#D3E0F8] text-[#1C1B1A] flex items-center justify-center font-semibold text-xs border border-white shrink-0 overflow-hidden">
                    {userAvatarUrl ? (
                      <img src={userAvatarUrl} alt={displayName} className="w-full h-full object-cover" />
                    ) : (
                      initial
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-700 truncate">
                      {displayName}
                    </p>
                    <p className="text-xs font-light text-zinc-400 truncate" title={userEmail}>
                      {userEmail || 'user@plurilog.app'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Menu Items */}
              <div className="space-y-0.5 text-sm text-zinc-600">
                <button
                  onClick={() => {
                    setIsProfileMenuOpen(false);
                    onOpenAccountSettings?.();
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-zinc-50 active:bg-zinc-100 text-[#6A675F] hover:text-[#1C1B1A] transition-colors cursor-pointer text-left target-secondary"
                >
                  <Settings className="w-4 h-4 text-[#8A867D]" />
                  <span className="font-normal">Account Settings</span>
                </button>

                <div className="border-t border-[#E7E5E0] my-1" />

                {onSignOut && (
                  <button
                    onClick={() => {
                      setIsProfileMenuOpen(false);
                      onSignOut();
                    }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-zinc-50 active:bg-zinc-100 text-[#6A675F] hover:text-[#1C1B1A] transition-colors cursor-pointer text-left target-secondary"
                  >
                    <LogOut className="w-4 h-4" />
                    <span className="font-normal">Log Out</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Desktop Collapsed Strip (Preserves existing desktop collapse UX on >= 1024px) */}
      {!desktopOpen && (
        <div className="hidden lg:flex lg:flex-col lg:items-center lg:py-2.5 lg:px-2 lg:border-r lg:border-[#E2E0DB] lg:bg-white shrink-0">
          <button
            onClick={toggleDesktop}
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 border border-zinc-200/80 bg-white transition-colors cursor-pointer target-primary flex items-center justify-center"
            title="Open sidebar"
            aria-label="Open sidebar"
          >
            <PanelLeftClose className="w-4 h-4 rotate-180" strokeWidth={1.5} />
          </button>
        </div>
      )}

      {/* Full Sidebar / Slide-Over Drawer */}
      <aside
        className={`absolute lg:static top-0 bottom-0 left-0 z-40 flex flex-col bg-white border-r border-[#E2E0DB] transition-all duration-200 ease-in-out ${
          drawerOpen
            ? 'w-[272px] translate-x-0 dashboard-menu-shadow'
            : 'w-[272px] -translate-x-full overflow-hidden'
        } ${
          desktopOpen
            ? 'lg:w-[272px] lg:translate-x-0 lg:shadow-none'
            : 'lg:w-0 lg:translate-x-0 lg:overflow-hidden'
        }`}
      >
        <div className="flex flex-col h-full w-[272px]">
          {/* Top Brand Header: compact logo, medium-weight title, and Sidebar Toggle */}
            <div className="h-[60px] px-4 border-b border-[#E2E0DB] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <img src="/logo.svg" alt="Plurilog" className="w-[22px] h-[22px] rounded-md object-contain" />
                <span className="font-semibold text-[16px] tracking-tight text-[#1C1B1A]">
                  Plurilog
                </span>
              </div>

              <button
                onClick={() => {
                  if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
                    toggleDesktop();
                  } else {
                    toggleDrawer();
                  }
                }}
                className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50 transition-colors cursor-pointer"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                <PanelLeftClose className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>

            {/* Action Bar: "New Discussion" Button in graduated grey */}
            <div className="px-3 pt-3 pb-2">
              <button
                onClick={onNewDebate}
                className="w-full h-11 flex items-center gap-2 px-3.5 rounded-xl bg-[#1C1B1A] hover:bg-[#2A2927] text-white font-medium text-sm transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4 text-white" />
                <span>New discussion</span>
              </button>
            </div>

            {/* Search Input: "Search discussions..." with Debounce & DB Search Loading Indicator */}
            <div className="px-3 pb-2">
              <div className="relative">
                {isSearchingDb ? (
                  <Loader2 className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8A867D] animate-spin" />
                ) : (
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8A867D]" />
                )}
                <input
                  type="text"
                  placeholder="Search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-10 pl-9 pr-3 text-sm touch-input-safe text-[#1C1B1A] font-normal rounded-xl border-0 bg-[#F4F3F0] placeholder:text-[#8A867D] focus:outline-none focus:ring-2 focus:ring-[#D9D6CF]/60 transition-all"
                />
              </div>
            </div>

            {/* Discussions List */}
            <div className="flex-1 min-h-0 overflow-y-auto px-2.5 py-2 dashboard-scrollbar">
              {filteredDebates.length === 0 ? (
                <div className="p-4 text-center text-sm font-normal text-[#8A867D]">
                  {debouncedQuery.trim() ? 'No discussions found' : 'No discussions yet'}
                </div>
              ) : (
                <div className="space-y-3">
                  {groupedDebates.map((group) => (
                    <section key={group.label}>
                      <div className="px-2 py-1 text-[12px] font-normal text-[#6A675F]">
                        {group.label}
                      </div>

                      <div className="space-y-0.5">
                        {group.items.map((debate) => {
                          const isActive = debate.id === activeDebateId;
                          const isMenuOpen = menuOpenDebateId === debate.id;
                          const isTitlePending = pendingTitleDiscussionIds?.has(debate.id) ?? false;

                          return (
                            <div
                              key={debate.id}
                              onClick={() => onSelectDebate(debate.id)}
                              className={`group/item relative w-full h-9 text-left px-2.5 rounded-[10px] transition-colors cursor-pointer flex items-center justify-between gap-1.5 ${
                                isTitlePending
                                  ? 'bg-[#EFEDE9] text-[#1C1B1A] animate-[pulse_1s_ease-in-out_infinite]'
                                  : isActive
                                    ? 'bg-[#EFEDE9] text-[#1C1B1A]'
                                    : 'bg-transparent hover:bg-[#F4F3F0] text-[#6A675F]'
                              }`}
                            >
                              {isTitlePending ? (
                                <div className="flex-1 min-w-0 h-4" />
                              ) : (
                                <span className={`text-[14px] truncate flex-1 ${
                                  isActive ? 'font-medium text-[#1C1B1A]' : 'font-normal text-[#1C1B1A]'
                                }`}>
                                  {debate.title}
                                </span>
                              )}

                              {onDeleteDebate && (
                                <div className="relative flex items-center justify-end shrink-0 -mr-1">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setMenuOpenDebateId(isMenuOpen ? null : debate.id);
                                    }}
                                    className={`p-1.5 rounded-lg text-[#8A867D] hover:text-[#1C1B1A] hover:bg-[#E7E5E0] transition-colors cursor-pointer flex items-center justify-center target-secondary ${
                                      isMenuOpen
                                        ? 'flex bg-[#E7E5E0] opacity-100'
                                        : 'flex opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/item:opacity-100 focus-within:opacity-100'
                                    }`}
                                    title="More options"
                                    aria-label="More options"
                                  >
                                    <MoreVertical className="w-3.5 h-3.5 shrink-0" />
                                  </button>

                                  {isMenuOpen && (
                                    <div
                                      ref={dropdownMenuRef}
                                      onClick={(e) => e.stopPropagation()}
                                      className="absolute right-0 top-full mt-1 w-32 rounded-[14px] bg-white border border-[#E2E0DB] dashboard-menu-shadow p-1.5 z-30 animate-in fade-in zoom-in-95 duration-100 text-left"
                                    >
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setMenuOpenDebateId(null);
                                          setConfirmDeleteDebate(debate);
                                        }}
                                        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-[10px] text-xs text-[#B5432E] hover:bg-[#F7F6F3] transition-colors cursor-pointer target-secondary"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        <span>Delete</span>
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>

            {/* Bottom User Profile Section with Drop-up Menu */}
            <div className="relative p-3 border-t border-[#E2E0DB] bg-white">
              {/* Drop-up Popover Menu */}
              {isProfileMenuOpen && (
                <div
                  ref={menuRef}
                  className="absolute bottom-full left-2 right-2 mb-2 bg-white rounded-xl border border-[#E2E0DB] dashboard-menu-shadow p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 max-h-[calc(100dvh-5rem)] overflow-y-auto"
                >
                  {/* User Profile Header in Menu */}
                  <div className="px-2.5 py-2 border-b border-[#E7E5E0] mb-1">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-[#D3E0F8] text-[#1C1B1A] flex items-center justify-center font-semibold text-xs border border-white shrink-0 overflow-hidden">
                        {userAvatarUrl ? (
                          <img src={userAvatarUrl} alt={displayName} className="w-full h-full object-cover" />
                        ) : (
                          initial
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-zinc-700 truncate">
                          {displayName}
                        </p>
                        <p className="text-xs font-light text-zinc-400 truncate" title={userEmail}>
                          {userEmail || 'user@plurilog.app'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Menu Items */}
                  <div className="space-y-0.5 text-xs text-zinc-600">
                    <button
                      onClick={() => {
                        setIsProfileMenuOpen(false);
                        onOpenAccountSettings?.();
                      }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-zinc-50 active:bg-zinc-100 text-[#6A675F] hover:text-[#1C1B1A] transition-colors cursor-pointer text-left target-secondary"
                    >
                      <Settings className="w-4 h-4 text-[#8A867D]" />
                      <span className="font-normal">Account Settings</span>
                    </button>

                    <div className="border-t border-[#E7E5E0] my-1" />

                    {onSignOut && (
                      <button
                        onClick={() => {
                          setIsProfileMenuOpen(false);
                          onSignOut();
                        }}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-zinc-50 active:bg-zinc-100 text-[#6A675F] hover:text-[#1C1B1A] transition-colors cursor-pointer text-left target-secondary"
                      >
                        <LogOut className="w-4 h-4 text-[#8A867D]" />
                        <span className="font-normal">Log Out</span>
                      </button>
                    )}

                    {onDeleteProfileClick && (
                      <>
                        <div className="border-t border-[#E7E5E0] my-1" />
                        <button
                          onClick={() => {
                            setIsProfileMenuOpen(false);
                            onDeleteProfileClick();
                          }}
                          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-zinc-50 active:bg-zinc-100 text-[#6A675F] hover:text-[#1C1B1A] transition-colors cursor-pointer text-left target-secondary"
                        >
                          <Trash2 className="w-4 h-4 text-[#8A867D]" />
                          <span className="font-normal">Delete account</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Main Profile Trigger Button */}
              <button
                ref={triggerRef}
                onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
                className={`w-full min-h-11 flex items-center justify-between px-2 py-1.5 rounded-xl border transition-colors cursor-pointer ${
                  isProfileMenuOpen
                    ? 'bg-[#F4F3F0] border-[#D9D6CF]'
                    : 'bg-white hover:bg-[#F7F6F3] border-transparent'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-[#D3E0F8] text-[#1C1B1A] flex items-center justify-center font-semibold text-xs border border-white shrink-0 overflow-hidden">
                    {userAvatarUrl ? (
                      <img src={userAvatarUrl} alt={displayName} className="w-full h-full object-cover" />
                    ) : (
                      initial
                    )}
                  </div>
                  <div className="text-left min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span 
                        className="text-sm font-medium text-[#1C1B1A] truncate max-w-[130px]" 
                        title={displayName}
                      >
                        {firstName}
                      </span>
                      <span className={`text-[10px] font-normal px-1.5 py-0.5 rounded-full shrink-0 border ${
                        userPlan === 'paid'
                          ? 'bg-white text-[#1C1B1A] border-[#D9D6CF]'
                          : 'bg-white text-[#6A675F] border-[#D9D6CF]'
                      }`}>
                        {userPlan === 'paid' ? 'Plus' : 'Free · Upgrade'}
                      </span>
                    </div>
                  </div>
                </div>

                <ChevronUp 
                  className={`w-4 h-4 text-zinc-400 transition-transform duration-150 shrink-0 ${
                    isProfileMenuOpen ? 'rotate-180 text-zinc-600' : ''
                  }`} 
                />
              </button>
            </div>
          </div>
      </aside>

      {/* Delete Confirmation Modal */}
      {confirmDeleteDebate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            onClick={() => setConfirmDeleteDebate(null)}
            className="fixed inset-0 bg-black/20 backdrop-blur-xs transition-opacity"
          />

          {/* Dialog Card */}
          <div className="relative w-full max-w-sm rounded-2xl bg-white border border-zinc-200/90 p-5 sm:p-6 shadow-xl z-10 animate-in fade-in zoom-in-95 duration-150 max-h-[calc(100dvh-2rem)] overflow-y-auto flex flex-col">
            <h3 className="text-base font-semibold text-zinc-900 tracking-tight mb-2">
              Delete discussion?
            </h3>
            <p className="text-xs sm:text-sm text-zinc-500 leading-relaxed mb-5">
              Are you sure you want to delete <span className="font-medium text-zinc-700">"{confirmDeleteDebate.title}"</span>? This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmDeleteDebate(null)}
                className="px-3.5 py-2.5 rounded-xl text-xs font-medium text-zinc-600 hover:text-zinc-900 active:bg-zinc-100 transition-colors cursor-pointer border border-zinc-200/80 flex items-center target-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={(e) => {
                  if (onDeleteDebate && confirmDeleteDebate) {
                    onDeleteDebate(confirmDeleteDebate.id, e);
                  }
                  setConfirmDeleteDebate(null);
                }}
                className="px-4 py-2.5 rounded-xl text-xs font-medium text-white bg-[#B5432E] hover:bg-[#963824] active:bg-[#7D2F20] transition-colors cursor-pointer flex items-center target-secondary"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
