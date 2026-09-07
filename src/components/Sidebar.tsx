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
          className="absolute inset-0 bg-black/10 backdrop-blur-xs z-30 lg:hidden transition-opacity"
        />
      )}

      {/* Compact Floating Trigger (Only rendered on small mobile < 680px when drawer is closed) */}
      {!drawerOpen && (
        <div className="absolute top-2.5 left-[max(0.75rem,env(safe-area-inset-left))] z-30 nav-rail:hidden">
          <button
            type="button"
            onClick={toggleDrawer}
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 border border-zinc-200/80 bg-white shadow-2xs transition-colors cursor-pointer target-primary flex items-center justify-center"
            title="Open discussions"
            aria-label="Open discussions"
          >
            <PanelLeftClose className="w-4 h-4 rotate-180" strokeWidth={1.5} />
          </button>
        </div>
      )}

      {/* Intermediate Persistent 56px Rail (Rendered between 680px and 1023px) */}
      <aside className="hidden nav-rail:flex lg:hidden flex-col justify-between items-center w-14 h-full bg-white border-r border-zinc-100 py-3 shrink-0 z-20 select-none">
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
            className="p-2 rounded-lg text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 active:bg-zinc-200/60 bg-zinc-50 border border-zinc-200/70 shadow-2xs transition-colors cursor-pointer target-primary flex items-center justify-center"
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
                : 'text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 active:bg-zinc-200/60'
            }`}
            title={drawerOpen ? 'Close discussions' : 'All discussions'}
            aria-label={drawerOpen ? 'Close discussions' : 'All discussions'}
          >
            <PanelLeftClose className={`w-4 h-4 transition-transform ${drawerOpen ? 'rotate-0 text-zinc-700' : 'rotate-180'}`} strokeWidth={1.5} />
          </button>
        </div>

        {/* Bottom Profile / Account Trigger */}
        <div className="flex flex-col items-center w-full px-2 relative">
          <button
            type="button"
            onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
            className="w-8 h-8 rounded-full bg-amber-50/80 text-amber-900 flex items-center justify-center font-semibold text-xs border border-amber-200/80 shrink-0 overflow-hidden hover:ring-2 hover:ring-zinc-300 transition-all cursor-pointer target-primary"
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
              className="absolute bottom-full left-2 mb-2 w-60 bg-white rounded-xl border border-zinc-200/90 shadow-lg p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 max-h-[calc(100dvh-5rem)] overflow-y-auto"
            >
              {/* User Profile Header in Menu */}
              <div className="px-2.5 py-2 border-b border-zinc-100 mb-1">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-amber-50/80 text-amber-900 flex items-center justify-center font-semibold text-xs border border-amber-200/80 shrink-0 overflow-hidden">
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
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-zinc-50 active:bg-zinc-100 text-zinc-600 hover:text-zinc-800 transition-colors cursor-pointer text-left target-secondary"
                >
                  <Settings className="w-4 h-4 text-zinc-400" />
                  <span className="font-normal">Account Settings</span>
                </button>

                <div className="border-t border-zinc-100 my-1" />

                {onSignOut && (
                  <button
                    onClick={() => {
                      setIsProfileMenuOpen(false);
                      onSignOut();
                    }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-zinc-50 active:bg-zinc-100 text-zinc-600 hover:text-zinc-800 transition-colors cursor-pointer text-left target-secondary"
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
        <div className="hidden lg:flex lg:flex-col lg:items-center lg:py-2.5 lg:px-2 lg:border-r lg:border-zinc-100 lg:bg-white shrink-0">
          <button
            onClick={toggleDesktop}
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 border border-zinc-200/80 bg-white shadow-2xs transition-colors cursor-pointer target-primary flex items-center justify-center"
            title="Open sidebar"
            aria-label="Open sidebar"
          >
            <PanelLeftClose className="w-4 h-4 rotate-180" strokeWidth={1.5} />
          </button>
        </div>
      )}

      {/* Full Sidebar / Slide-Over Drawer */}
      <aside
        className={`absolute lg:static top-0 bottom-0 left-0 z-40 flex flex-col bg-white border-r border-zinc-100 transition-all duration-200 ease-in-out ${
          drawerOpen
            ? 'w-72 translate-x-0 shadow-xl'
            : 'w-72 -translate-x-full overflow-hidden'
        } ${
          desktopOpen
            ? 'lg:w-72 lg:translate-x-0 lg:shadow-none'
            : 'lg:w-0 lg:translate-x-0 lg:overflow-hidden'
        }`}
      >
        <div className="flex flex-col h-full w-72">
          {/* Top Brand Header: Logo, Bold Title (700) in dark grey (zinc-800), and Sidebar Toggle */}
            <div className="h-14 px-4.5 border-b border-zinc-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <img src="/logo.svg" alt="Plurilog" className="w-6 h-6 rounded-md object-contain" />
                <span className="font-semibold text-sm tracking-tight text-zinc-900">
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
            <div className="p-3">
              <button
                onClick={onNewDebate}
                className="w-full flex items-center gap-2 py-2.5 px-3.5 rounded-lg bg-zinc-50 hover:bg-zinc-100/90 text-zinc-500 hover:text-zinc-700 font-medium text-sm shadow-2xs transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4 text-zinc-500" />
                <span>New Discussion</span>
              </button>
            </div>

            {/* Search Input: "Search discussions..." with Debounce & DB Search Loading Indicator */}
            <div className="px-3 pb-2">
              <div className="relative">
                {isSearchingDb ? (
                  <Loader2 className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 animate-spin" />
                ) : (
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                )}
                <input
                  type="text"
                  placeholder="Search discussions..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm touch-input-safe text-zinc-700 font-normal rounded-lg border border-zinc-200/60 bg-zinc-50 placeholder:text-zinc-400 focus:outline-none focus:bg-white focus:border-zinc-300 focus:ring-1 focus:ring-zinc-300 transition-all"
                />
              </div>
            </div>

            {/* Discussions List */}
            <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-1">
              {/* Normal/regular font weight, mid-grey label */}
              <div className="px-2.5 py-1 text-xs font-normal text-zinc-400 flex items-center justify-between">
                <span>Discussions</span>
                <span className="font-mono text-xs font-normal text-zinc-400">{filteredDebates.length}</span>
              </div>

              {filteredDebates.length === 0 ? (
                <div className="p-4 text-center text-sm font-light text-zinc-400">
                  {debouncedQuery.trim() ? 'No discussions found' : 'No discussions yet'}
                </div>
              ) : (
                filteredDebates.map((debate) => {
                  const isActive = debate.id === activeDebateId;
                  const isMenuOpen = menuOpenDebateId === debate.id;
                  const isTitlePending = pendingTitleDiscussionIds?.has(debate.id) ?? false;

                  return (
                    <div
                      key={debate.id}
                      onClick={() => onSelectDebate(debate.id)}
                      className={`group/item relative w-full text-left px-3 py-2.5 rounded-xl transition-colors cursor-pointer flex items-center justify-between gap-1.5 ${
                        isTitlePending
                          ? isActive
                            ? 'bg-zinc-200/80 shadow-2xs text-zinc-900 animate-[pulse_1s_ease-in-out_infinite]'
                            : 'bg-zinc-200/70 text-zinc-600 animate-[pulse_1s_ease-in-out_infinite]'
                          : isActive
                            ? 'bg-zinc-100 shadow-2xs text-zinc-900'
                            : 'bg-white hover:bg-zinc-50/80 text-zinc-600'
                      }`}
                    >
                      {isTitlePending ? (
                        <div className="flex-1 min-w-0 h-5" />
                      ) : (
                        <span className={`text-[13px] truncate flex-1 ${
                          isActive ? 'font-normal text-zinc-900' : 'font-normal text-zinc-600 group-hover/item:text-zinc-800'
                        }`}>
                          {debate.title}
                        </span>
                      )}
                      
                      {/* Three-Dot Menu Trigger */}
                      {onDeleteDebate && (
                        <div className="relative flex items-center justify-end shrink-0 -mr-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuOpenDebateId(isMenuOpen ? null : debate.id);
                            }}
                            className={`p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200/60 transition-colors cursor-pointer flex items-center justify-center target-secondary ${
                              isMenuOpen
                                ? 'flex text-zinc-700 bg-zinc-200/60 opacity-100'
                                : 'flex text-zinc-400 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/item:opacity-100 focus-within:opacity-100'
                            }`}
                            title="More options"
                            aria-label="More options"
                          >
                            <MoreVertical className="w-3.5 h-3.5 shrink-0" />
                          </button>

                          {/* Dropdown Menu */}
                          {isMenuOpen && (
                            <div
                              ref={dropdownMenuRef}
                              onClick={(e) => e.stopPropagation()}
                              className="absolute right-0 top-full mt-1 w-28 rounded-xl bg-white border border-zinc-200/90 shadow-lg p-1 z-30 animate-in fade-in zoom-in-95 duration-100 text-left"
                            >
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setMenuOpenDebateId(null);
                                  setConfirmDeleteDebate(debate);
                                }}
                                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-zinc-600 hover:bg-zinc-50 active:bg-zinc-100 hover:text-zinc-800 transition-colors cursor-pointer target-secondary"
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
                })
              )}
            </div>

            {/* Bottom User Profile Section with Drop-up Menu */}
            <div className="relative p-2.5 border-t border-zinc-100 bg-white">
              {/* Drop-up Popover Menu */}
              {isProfileMenuOpen && (
                <div
                  ref={menuRef}
                  className="absolute bottom-full left-2 right-2 mb-2 bg-white rounded-xl border border-zinc-200/90 shadow-lg p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 max-h-[calc(100dvh-5rem)] overflow-y-auto"
                >
                  {/* User Profile Header in Menu */}
                  <div className="px-2.5 py-2 border-b border-zinc-100 mb-1">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-amber-50/80 text-amber-900 flex items-center justify-center font-semibold text-xs border border-amber-200/80 shrink-0 overflow-hidden">
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
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-zinc-50 active:bg-zinc-100 text-zinc-600 hover:text-zinc-800 transition-colors cursor-pointer text-left target-secondary"
                    >
                      <Settings className="w-4 h-4 text-zinc-400" />
                      <span className="font-normal">Account Settings</span>
                    </button>

                    <div className="border-t border-zinc-100 my-1" />

                    {onSignOut && (
                      <button
                        onClick={() => {
                          setIsProfileMenuOpen(false);
                          onSignOut();
                        }}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-zinc-50 active:bg-zinc-100 text-zinc-600 hover:text-zinc-800 transition-colors cursor-pointer text-left target-secondary"
                      >
                        <LogOut className="w-4 h-4" />
                        <span className="font-normal">Log Out</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Main Profile Trigger Button */}
              <button
                ref={triggerRef}
                onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
                className={`w-full flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer ${
                  isProfileMenuOpen
                    ? 'bg-zinc-50 border-zinc-300 shadow-2xs'
                    : 'bg-white hover:bg-zinc-50 border-zinc-200/80 shadow-2xs'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-amber-50/80 text-amber-900 flex items-center justify-center font-semibold text-xs border border-amber-200/80 shrink-0 overflow-hidden">
                    {userAvatarUrl ? (
                      <img src={userAvatarUrl} alt={displayName} className="w-full h-full object-cover" />
                    ) : (
                      initial
                    )}
                  </div>
                  <div className="text-left min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span 
                        className="text-sm font-medium text-zinc-700 truncate max-w-[130px]" 
                        title={displayName}
                      >
                        {firstName}
                      </span>
                      <span className={`text-[10px] font-normal px-1.5 py-0.5 rounded-full shrink-0 border ${
                        userPlan === 'paid'
                          ? 'bg-zinc-100 text-zinc-700 border-zinc-200/80'
                          : 'bg-zinc-100 text-zinc-500 border-zinc-200/60'
                      }`}>
                        {userPlan === 'paid' ? 'Plus' : 'Free'}
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
                className="px-4 py-2.5 rounded-xl text-xs font-medium text-white bg-red-600 hover:bg-red-700 active:bg-red-800 transition-colors cursor-pointer shadow-2xs flex items-center target-secondary"
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
