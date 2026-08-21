'use client';

import React, { useState, useRef, useEffect } from 'react';
import { 
  Plus, 
  Search, 
  PanelLeftClose, 
  Layers,
  Settings,
  LogOut,
  ChevronUp,
  Sparkles,
  Sun,
  Trash2
} from 'lucide-react';
import { DebateTopic } from '../types/chat';

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
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const filteredDebates = debates.filter((debate) => {
    return (
      (debate.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (debate.snippet || '').toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  // Close drop-up menu when clicking outside
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
    };

    if (isProfileMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isProfileMenuOpen]);

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

      <aside
        className={`fixed lg:static top-0 bottom-0 left-0 z-40 flex flex-col bg-white border-r border-zinc-100 transition-all duration-200 ease-in-out ${
          isOpen ? 'w-72 translate-x-0' : 'w-0 -translate-x-full lg:w-0 lg:translate-x-0 overflow-hidden'
        }`}
      >
        {isOpen && (
          <div className="flex flex-col h-full w-72">
            {/* Top Brand Header */}
            <div className="h-14 px-4.5 border-b border-zinc-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-md bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-900 shadow-2xs">
                  <Layers className="w-3.5 h-3.5" />
                </div>
                <span className="font-semibold text-base tracking-tight text-zinc-900">
                  Plurilog
                </span>
              </div>

              <button
                onClick={onToggle}
                className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 transition-colors cursor-pointer"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>

            {/* Action Bar: "+ New Discussion" Button */}
            <div className="p-3">
              <button
                onClick={onNewDebate}
                className="w-full flex items-center justify-between py-2.5 px-3.5 rounded-lg bg-amber-50 hover:bg-amber-100/70 border border-amber-200/80 text-zinc-900 font-medium text-sm shadow-2xs transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Plus className="w-4 h-4 text-amber-800" />
                  <span>+ New Discussion</span>
                </div>
                <span className="text-xs text-amber-800/70 font-mono">
                  ⌘N
                </span>
              </button>
            </div>

            {/* Search Input: "Search discussions..." */}
            <div className="px-3 pb-2">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  type="text"
                  placeholder="Search discussions..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm text-zinc-900 rounded-lg border border-zinc-200/60 bg-zinc-50 placeholder:text-zinc-400 focus:outline-none focus:bg-white focus:border-zinc-300 focus:ring-1 focus:ring-zinc-300 transition-all"
                />
              </div>
            </div>

            {/* Discussions List */}
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
              <div className="px-2.5 py-1 text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                <span>Discussions</span>
                <span className="font-mono text-xs">{filteredDebates.length}</span>
              </div>

              {filteredDebates.length === 0 ? (
                <div className="p-4 text-center text-sm text-zinc-400">
                  {searchQuery.trim() ? 'No discussions found' : 'No discussions yet'}
                </div>
              ) : (
                filteredDebates.map((debate) => {
                  const isActive = debate.id === activeDebateId;
                  return (
                    <div
                      key={debate.id}
                      onClick={() => onSelectDebate(debate.id)}
                      className={`group/item relative w-full text-left p-3 rounded-xl transition-all cursor-pointer flex flex-col gap-1 ${
                        isActive
                          ? 'bg-amber-50/50 border border-amber-200/80 shadow-2xs text-zinc-900'
                          : 'bg-white hover:bg-zinc-50/80 border border-transparent text-zinc-600'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 w-full">
                        <span className="font-medium text-sm text-zinc-900 truncate flex-1 pr-2">
                          {debate.title}
                        </span>
                        <div className="flex items-center shrink-0">
                          <span className="text-xs text-zinc-400 font-mono group-hover/item:hidden">
                            {debate.createdAt}
                          </span>
                          {onDeleteDebate && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteDebate(debate.id, e);
                              }}
                              className="hidden group-hover/item:flex items-center justify-center p-1 rounded-md text-zinc-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                              title="Delete discussion"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      <p className="text-xs text-zinc-400 line-clamp-1">
                        {debate.snippet || ''}
                      </p>
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
                        <p className="text-sm font-semibold text-zinc-900 truncate">
                          {displayName}
                        </p>
                        <p className="text-xs text-zinc-400 truncate" title={userEmail}>
                          {userEmail || 'user@plurilog.app'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Menu Items */}
                  <div className="space-y-0.5 text-sm text-zinc-700">
                    <button
                      onClick={() => setIsProfileMenuOpen(false)}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-zinc-50 text-zinc-700 hover:text-zinc-900 transition-colors cursor-pointer text-left"
                    >
                      <Settings className="w-4 h-4 text-zinc-400" />
                      <span>Account Settings</span>
                    </button>

                    <button
                      onClick={() => setIsProfileMenuOpen(false)}
                      className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-zinc-50 text-zinc-700 hover:text-zinc-900 transition-colors cursor-pointer text-left"
                    >
                      <div className="flex items-center gap-2.5">
                        <Sparkles className="w-4 h-4 text-amber-600" />
                        <span>Manage Subscription</span>
                      </div>
                      <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200/80">
                        Free
                      </span>
                    </button>

                    <button
                      onClick={() => setIsProfileMenuOpen(false)}
                      className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-zinc-50 text-zinc-700 hover:text-zinc-900 transition-colors cursor-pointer text-left"
                    >
                      <div className="flex items-center gap-2.5">
                        <Sun className="w-4 h-4 text-zinc-400" />
                        <span>Appearance</span>
                      </div>
                      <span className="text-xs text-zinc-400 font-mono">
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
                        className="text-sm font-medium text-zinc-900 truncate max-w-[130px]" 
                        title={userEmail || displayName}
                      >
                        {userEmail || displayName}
                      </span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 border border-zinc-200/60 shrink-0">
                        Free
                      </span>
                    </div>
                  </div>
                </div>

                <ChevronUp 
                  className={`w-4 h-4 text-zinc-400 transition-transform duration-150 shrink-0 ${
                    isProfileMenuOpen ? 'rotate-180 text-zinc-700' : ''
                  }`} 
                />
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
};
