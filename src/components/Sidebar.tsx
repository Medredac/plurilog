'use client';

import React, { useState, useRef, useEffect } from 'react';
import { 
  Plus, 
  Search, 
  PanelLeftClose, 
  Settings,
  LogOut,
  ChevronUp,
  Sparkles,
  Sun,
  Trash2,
  MoreVertical,
  Loader2
} from 'lucide-react';
import { DebateTopic } from '../types/chat';
import { createClient } from '../utils/supabase/client';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  debates: DebateTopic[];
  activeDebateId: string;
  onSelectDebate: (id: string) => void;
  onNewDebate: () => void;
  onDeleteDebate?: (id: string, e: React.MouseEvent) => void;
  userEmail?: string;
  onSignOut?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onToggle,
  debates,
  activeDebateId,
  onSelectDebate,
  onNewDebate,
  onDeleteDebate,
  userEmail,
  onSignOut,
}) => {
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

  const displayName = userEmail ? userEmail.split('@')[0] : 'User';
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          onClick={onToggle}
          className="fixed inset-0 bg-black/10 backdrop-blur-xs z-30 lg:hidden transition-opacity"
        />
      )}

      {/* Collapsed Rail Trigger (Only rendered when sidebar is closed) */}
      {!isOpen && (
        <div className="fixed top-2.5 left-3 z-30 lg:static lg:flex lg:flex-col lg:items-center lg:py-2.5 lg:px-2 lg:border-r lg:border-zinc-100 lg:bg-white shrink-0">
          <button
            onClick={onToggle}
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 border border-zinc-200/80 bg-white shadow-2xs transition-colors cursor-pointer"
            title="Open sidebar"
            aria-label="Open sidebar"
          >
            <PanelLeftClose className="w-4 h-4 rotate-180" strokeWidth={1.5} />
          </button>
        </div>
      )}

      <aside
        className={`fixed lg:static top-0 bottom-0 left-0 z-40 flex flex-col bg-white border-r border-zinc-100 transition-all duration-200 ease-in-out ${
          isOpen ? 'w-72 translate-x-0' : 'w-0 -translate-x-full lg:w-0 lg:translate-x-0 overflow-hidden'
        }`}
      >
        {isOpen && (
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
                onClick={onToggle}
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
                className="w-full flex items-center gap-2 py-2.5 px-3.5 rounded-lg bg-zinc-50 hover:bg-zinc-100/90 text-zinc-700 hover:text-zinc-900 font-medium text-sm shadow-2xs transition-colors cursor-pointer"
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
                  className="w-full pl-9 pr-3 py-2 text-sm text-zinc-700 font-normal rounded-lg border border-zinc-200/60 bg-zinc-50 placeholder:text-zinc-400 focus:outline-none focus:bg-white focus:border-zinc-300 focus:ring-1 focus:ring-zinc-300 transition-all"
                />
              </div>
            </div>

            {/* Discussions List */}
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
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

                  return (
                    <div
                      key={debate.id}
                      onClick={() => onSelectDebate(debate.id)}
                      className={`group/item relative w-full text-left px-3 py-2.5 rounded-xl transition-all cursor-pointer flex items-center justify-between gap-1.5 ${
                        isActive
                          ? 'bg-amber-50/80 shadow-2xs text-zinc-800'
                          : 'bg-white hover:bg-zinc-50/80 text-zinc-600'
                      }`}
                    >
                      <span className={`text-sm truncate flex-1 pr-2 ${
                        isActive ? 'font-normal text-amber-900' : 'font-normal text-zinc-600 group-hover/item:text-zinc-800'
                      }`}>
                        {debate.title}
                      </span>
                      
                      <div className="flex items-center shrink-0">
                        {/* Timestamp (hidden when hovering or menu open) */}
                        <span className={`text-[10px] text-zinc-400 font-mono font-light ${
                          isMenuOpen ? 'hidden' : 'group-hover/item:hidden'
                        }`}>
                          {debate.createdAt}
                        </span>

                        {/* Three-Dot Menu Trigger */}
                        {onDeleteDebate && (
                          <div className="relative">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMenuOpenDebateId(isMenuOpen ? null : debate.id);
                              }}
                              className={`p-1 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200/60 transition-colors cursor-pointer ${
                                isMenuOpen ? 'flex text-zinc-700 bg-zinc-200/60' : 'hidden group-hover/item:flex'
                              }`}
                              title="More options"
                            >
                              <MoreVertical className="w-4 h-4" />
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
                                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>Delete</span>
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
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
                  className="absolute bottom-full left-2 right-2 mb-2 bg-white rounded-xl border border-zinc-200/90 shadow-lg p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100"
                >
                  {/* User Profile Header in Menu */}
                  <div className="px-2.5 py-2 border-b border-zinc-100 mb-1">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-amber-100 text-amber-900 flex items-center justify-center font-semibold text-xs border border-amber-200/80 shrink-0">
                        {initial}
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
                      onClick={() => setIsProfileMenuOpen(false)}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-zinc-50 text-zinc-600 hover:text-zinc-800 transition-colors cursor-pointer text-left"
                    >
                      <Settings className="w-4 h-4 text-zinc-400" />
                      <span className="font-normal">Account Settings</span>
                    </button>

                    <button
                      onClick={() => setIsProfileMenuOpen(false)}
                      className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-zinc-50 text-zinc-600 hover:text-zinc-800 transition-colors cursor-pointer text-left"
                    >
                      <div className="flex items-center gap-2.5">
                        <Sparkles className="w-4 h-4 text-amber-600" />
                        <span className="font-normal">Manage Subscription</span>
                      </div>
                      <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200/80">
                        Free
                      </span>
                    </button>

                    <button
                      onClick={() => setIsProfileMenuOpen(false)}
                      className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-zinc-50 text-zinc-600 hover:text-zinc-800 transition-colors cursor-pointer text-left"
                    >
                      <div className="flex items-center gap-2.5">
                        <Sun className="w-4 h-4 text-zinc-400" />
                        <span className="font-normal">Appearance</span>
                      </div>
                      <span className="text-xs font-mono font-light text-zinc-400">
                        Light
                      </span>
                    </button>

                    <div className="border-t border-zinc-100 my-1" />

                    {onSignOut && (
                      <button
                        onClick={() => {
                          setIsProfileMenuOpen(false);
                          onSignOut();
                        }}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-red-50 text-red-600 hover:text-red-700 transition-colors cursor-pointer text-left font-medium"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>Log Out</span>
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
                  <div className="w-7 h-7 rounded-full bg-amber-100 text-amber-900 flex items-center justify-center font-semibold text-xs border border-amber-200/80 shrink-0">
                    {initial}
                  </div>
                  <div className="text-left min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span 
                        className="text-sm font-medium text-zinc-700 truncate max-w-[130px]" 
                        title={userEmail || displayName}
                      >
                        {userEmail || displayName}
                      </span>
                      <span className="text-[10px] font-mono font-normal px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 border border-zinc-200/60 shrink-0">
                        Free
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
        )}
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
          <div className="relative w-full max-w-sm rounded-2xl bg-white border border-zinc-200/90 p-5 sm:p-6 shadow-xl z-10 animate-in fade-in zoom-in-95 duration-150">
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
                className="px-3.5 py-2 rounded-xl text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 transition-colors cursor-pointer border border-zinc-200/80"
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
                className="px-3.5 py-2 rounded-xl text-xs font-medium text-white bg-red-600 hover:bg-red-700 transition-colors cursor-pointer shadow-2xs"
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
