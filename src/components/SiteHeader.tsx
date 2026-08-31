'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight } from 'lucide-react';

interface SiteHeaderProps {
  onGetStartedClick?: () => void;
}

export const SiteHeader: React.FC<SiteHeaderProps> = ({ onGetStartedClick }) => {
  const pathname = usePathname();

  const handleLogoClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (pathname === '/') {
      e.preventDefault();
      const heroEl = document.getElementById('hero');
      if (heroEl) {
        heroEl.scrollIntoView({ behavior: 'smooth' });
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  };

  return (
    <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-zinc-100 px-6 sm:px-12 py-3.5 flex items-center justify-between">
      {/* Brand */}
      <Link
        href="/"
        onClick={handleLogoClick}
        className="flex items-center gap-2 group cursor-pointer"
      >
        <img src="/logo.svg" alt="Plurilog" className="w-6 h-6 rounded-md object-contain" />
        <span className="font-semibold text-sm tracking-tight text-zinc-900">
          Plurilog
        </span>
      </Link>

      {/* Right Actions */}
      <div className="flex items-center gap-3">
        {onGetStartedClick ? (
          <button
            type="button"
            onClick={onGetStartedClick}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white font-medium text-xs shadow-xs transition-colors cursor-pointer"
          >
            <span>Get Started for Free</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        ) : (
          <Link
            href="/"
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white font-medium text-xs shadow-xs transition-colors cursor-pointer"
          >
            <span>Get Started for Free</span>
            <ArrowRight className="w-3 h-3" />
          </Link>
        )}
      </div>
    </header>
  );
};

export default SiteHeader;
