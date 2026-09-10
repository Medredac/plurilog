'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { ArrowRight, Menu, X } from 'lucide-react';

const drawerVariants = {
  initial: (reduce: boolean | null) => ({
    height: reduce ? 'auto' : 0,
    opacity: reduce ? 0 : 1,
  }),
  animate: (reduce: boolean | null) => ({
    height: 'auto',
    opacity: 1,
    transition: {
      height: {
        duration: reduce ? 0.01 : 0.22,
        ease: [0.16, 1, 0.3, 1] as const,
      },
      opacity: {
        duration: reduce ? 0.1 : 0.22,
      },
    },
  }),
  exit: (reduce: boolean | null) => ({
    height: reduce ? 'auto' : 0,
    opacity: reduce ? 0 : 1,
    transition: {
      height: {
        duration: reduce ? 0.01 : 0.18,
        ease: [0.4, 0, 1, 1] as const,
      },
      opacity: {
        duration: reduce ? 0.1 : 0.18,
      },
    },
  }),
};

const navContentVariants = {
  initial: (reduce: boolean | null) => ({
    opacity: 0,
    y: reduce ? 0 : -6,
  }),
  animate: (reduce: boolean | null) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.18,
      delay: reduce ? 0 : 0.03,
      ease: [0.16, 1, 0.3, 1] as const,
    },
  }),
  exit: (reduce: boolean | null) => ({
    opacity: 0,
    y: reduce ? 0 : -4,
    transition: {
      duration: 0.13,
      ease: [0.4, 0, 1, 1] as const,
    },
  }),
};

interface SiteHeaderProps {
  onGetStartedClick?: () => void;
}

export const SiteHeader: React.FC<SiteHeaderProps> = ({ onGetStartedClick }) => {
  const pathname = usePathname();
  const shouldReduceMotion = useReducedMotion();
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
            className="md:hidden p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors cursor-pointer flex items-center justify-center w-7 h-7"
            aria-label={isMobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={isMobileMenuOpen}
          >
            <AnimatePresence mode="wait" initial={false}>
              {isMobileMenuOpen ? (
                <motion.span
                  key="close"
                  initial={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.9, rotate: shouldReduceMotion ? 0 : -8 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  exit={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.9, rotate: shouldReduceMotion ? 0 : 8 }}
                  transition={{ duration: 0.12 }}
                  className="flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </motion.span>
              ) : (
                <motion.span
                  key="menu"
                  initial={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.9, rotate: shouldReduceMotion ? 0 : 8 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  exit={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.9, rotate: shouldReduceMotion ? 0 : -8 }}
                  transition={{ duration: 0.12 }}
                  className="flex items-center justify-center"
                >
                  <Menu className="w-4 h-4" />
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      <AnimatePresence initial={false}>
        {isMobileMenuOpen && (
          <motion.div
            custom={shouldReduceMotion}
            variants={drawerVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="md:hidden overflow-hidden"
          >
            <motion.nav
              custom={shouldReduceMotion}
              variants={navContentVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="pt-3 pb-1 border-t border-zinc-100 mt-3 flex flex-col gap-1 text-xs font-medium text-zinc-600"
            >
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
            </motion.nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
};

export default SiteHeader;
