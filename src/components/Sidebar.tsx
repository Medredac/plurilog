'use client';

import React, { useState } from 'react';
import { 
  Plus, 
  Search, 
  PanelLeftClose, 
  Layers,
  Settings
} from 'lucide-react';
import { DebateTopic } from '../types/chat';
import { COUNCIL_MEMBERS } from '../data/mockDebates';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  debates: DebateTopic[];
  activeDebateId: string;
  onSelectDebate: (id: string) => void;
  onNewDebate: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onToggle,
  debates,
  activeDebateId,
  onSelectDebate,
  onNewDebate,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredDebates = debates.filter((debate) => {
    return (
      debate.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      debate.snippet.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

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
          isOpen ? 'w-64 translate-x-0' : 'w-0 -translate-x-full lg:w-0 lg:translate-x-0 overflow-hidden'
        }`}
      >
        {isOpen && (
          <div className="flex flex-col h-full w-64">
            {/* Top Brand Header: Just Plurilog, no Council badge */}
            <div className="h-13 px-4 border-b border-zinc-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-md bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-900 shadow-2xs">
                  <Layers className="w-3 h-3" />
                </div>
                <span className="font-semibold text-sm tracking-tight text-zinc-900">
                  Plurilog
                </span>
              </div>

              <button
                onClick={onToggle}
                className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 transition-colors cursor-pointer"
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
                className="w-full flex items-center justify-between py-2 px-3 rounded-lg bg-amber-50 hover:bg-amber-100/70 border border-amber-200/80 text-zinc-900 font-medium text-xs shadow-2xs transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Plus className="w-3.5 h-3.5 text-amber-800" />
                  <span>+ New Discussion</span>
                </div>
                <span className="text-[10px] text-amber-800/70 font-mono">
                  ⌘N
                </span>
              </button>
            </div>

            {/* Search Input: "Search discussions..." */}
            <div className="px-3 pb-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  type="text"
                  placeholder="Search discussions..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-2.5 py-1.5 text-xs text-zinc-900 rounded-lg border border-zinc-200/60 bg-zinc-50 placeholder:text-zinc-400 focus:outline-none focus:bg-white focus:border-zinc-300 focus:ring-1 focus:ring-zinc-300 transition-all"
                />
              </div>
            </div>

            {/* Discussions List */}
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
              <div className="px-2 py-1 text-[11px] font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                <span>Discussions</span>
                <span className="font-mono text-[10px]">{filteredDebates.length}</span>
              </div>

              {filteredDebates.length === 0 ? (
                <div className="p-4 text-center text-xs text-zinc-400">
                  No discussions found
                </div>
              ) : (
                filteredDebates.map((debate) => {
                  const isActive = debate.id === activeDebateId;
                  return (
                    <button
                      key={debate.id}
                      onClick={() => onSelectDebate(debate.id)}
                      className={`w-full text-left p-2.5 rounded-xl text-xs transition-all group cursor-pointer flex flex-col gap-0.5 ${
                        isActive
                          ? 'bg-amber-50/50 border border-amber-200/80 shadow-2xs text-zinc-900'
                          : 'bg-white hover:bg-zinc-50/80 border border-transparent text-zinc-600'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 w-full">
                        <span className="font-medium text-zinc-900 truncate flex-1">
                          {debate.title}
                        </span>
                        <span className="text-[10px] text-zinc-400 shrink-0 font-mono">
                          {debate.createdAt}
                        </span>
                      </div>

                      <p className="text-[11px] text-zinc-400 line-clamp-1">
                        {debate.snippet}
                      </p>
                    </button>
                  );
                })
              )}
            </div>

            {/* Bottom Footer User Info */}
            <div className="p-3 border-t border-zinc-100 flex items-center justify-between bg-white">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-zinc-100 text-zinc-700 flex items-center justify-center font-medium text-xs border border-zinc-200/60">
                  R
                </div>
                <span className="text-xs font-medium text-zinc-900">Reda</span>
              </div>

              <button 
                className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 transition-colors cursor-pointer"
                title="Settings"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
};
