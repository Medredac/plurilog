'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, Menu, X } from 'lucide-react';

interface SiteHeaderProps {
  onGetStartedClick?: () => void;
}

export const SiteHeader: React.FC<SiteHeaderProps> = ({ onGetStartedClick }) => {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  // Close mobile menu on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMobileMenuOpen(false);
      }
    };
    if (isMobileMenuOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobileMenuOpen]);

  // Close mobile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setIsMobileMenuOpen(false);
      }
    };
    if (isMobileMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMobileMenuOpen]);

  // Close mobile menu on route change
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  const handleLogoClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    setIsMobileMenuOpen(false);
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

  const handleAboutClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    setIsMobileMenuOpen(false);
    if (pathname === '/') {
      e.preventDefault();
      const aboutEl = document.getElementById('about');
      if (aboutEl) {
        aboutEl.scrollIntoView({ behavior: 'smooth' });
      }
    }
  };

  return (
    <header ref={headerRef} className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-zinc-100 px-6 sm:px-12 py-3.5">
      <div className="flex items-center justify-between">
        {/* Brand */}
        <Link
          href="/"
          onClick={handleLogoClick}
          className="flex items-center gap-2 group cursor-pointer shrink-0"
        >
          <img src="/logo.svg" alt="Plurilog" className="w-6 h-6 rounded-md object-contain" />
          <span className="font-semibold text-sm tracking-tight text-zinc-900">
            Plurilog
          </span>
        </Link>

        {/* Centered Navigation (Desktop) */}
        <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-zinc-500 absolute left-1/2 -translate-x-1/2">
          <Link
            href="/#about"
            onClick={handleAboutClick}
            className="hover:text-zinc-900 transition-colors cursor-pointer"
          >
            About
          </Link>
          <Link
            href="/terms"
            className="hover:text-zinc-900 transition-colors cursor-pointer"
          >
            Terms
          </Link>
          <Link
            href="/privacy"
            className="hover:text-zinc-900 transition-colors cursor-pointer"
          >
            Privacy
          </Link>
          <Link
            href="/blog"
            className="hover:text-zinc-900 transition-colors cursor-pointer"
          >
            Blog
          </Link>
        </nav>

        {/* Right Actions & Mobile Trigger */}
        <div className="flex items-center gap-2.5 shrink-0">
          {onGetStartedClick ? (
            <button
              type="button"
              onClick={() => {
                setIsMobileMenuOpen(false);
                onGetStartedClick();
              }}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white font-medium text-xs shadow-xs transition-colors cursor-pointer"
            >
              <span>Get Started</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          ) : (
            <Link
              href="/?signup=true"
              onClick={() => setIsMobileMenuOpen(false)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white font-medium text-xs shadow-xs transition-colors cursor-pointer"
            >
              <span>Get Started</span>
              <ArrowRight className="w-3 h-3" />
            </Link>
          )}

          {/* Mobile Menu Button */}
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen((prev) => !prev)}
            className="md:hidden p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors cursor-pointer"
            aria-label={isMobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={isMobileMenuOpen}
          >
            {isMobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Dropdown */}
      {isMobileMenuOpen && (
        <nav className="md:hidden pt-3 pb-1 border-t border-zinc-100 mt-3 flex flex-col gap-1 text-xs font-medium text-zinc-600 animate-in fade-in slide-in-from-top-1 duration-150">
          <Link
            href="/#about"
            onClick={handleAboutClick}
            className="px-2.5 py-2 rounded-lg hover:bg-zinc-50 hover:text-zinc-900 transition-colors cursor-pointer"
          >
            About
          </Link>
          <Link
            href="/terms"
            onClick={() => setIsMobileMenuOpen(false)}
            className="px-2.5 py-2 rounded-lg hover:bg-zinc-50 hover:text-zinc-900 transition-colors cursor-pointer"
          >
            Terms
          </Link>
          <Link
            href="/privacy"
            onClick={() => setIsMobileMenuOpen(false)}
            className="px-2.5 py-2 rounded-lg hover:bg-zinc-50 hover:text-zinc-900 transition-colors cursor-pointer"
          >
            Privacy
          </Link>
          <Link
            href="/blog"
            onClick={() => setIsMobileMenuOpen(false)}
            className="px-2.5 py-2 rounded-lg hover:bg-zinc-50 hover:text-zinc-900 transition-colors cursor-pointer"
          >
            Blog
          </Link>
        </nav>
      )}
    </header>
  );
};

export default SiteHeader;
