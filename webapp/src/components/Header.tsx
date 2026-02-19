'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Header() {
  const pathname = usePathname();

  return (
    <header className="border-b border-warm-gray-lighter bg-white/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gold/10 border border-gold/30 flex items-center justify-center">
            <svg className="w-4 h-4 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <div>
            <span className="text-sm font-semibold tracking-wide text-charcoal">The Grand Azure</span>
            <span className="text-[10px] text-gold ml-2 tracking-widest uppercase hidden sm:inline">Hotel & Residences</span>
          </div>
        </Link>

        <nav className="flex items-center gap-6 text-sm">
          <Link
            href="/book"
            className={`transition-colors ${
              pathname === '/book' ? 'text-gold font-medium' : 'text-warm-gray hover:text-charcoal'
            }`}
          >
            Book
          </Link>
          <Link
            href="/admin"
            className={`transition-colors ${
              pathname === '/admin' ? 'text-gold font-medium' : 'text-warm-gray hover:text-charcoal'
            }`}
          >
            Admin
          </Link>
        </nav>
      </div>
    </header>
  );
}
