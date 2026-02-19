import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="relative flex flex-col items-center justify-center text-center px-6 py-32 sm:py-44">
        <div className="absolute inset-0 bg-gradient-to-b from-cream via-cream to-cream-dark pointer-events-none" />
        <div className="relative z-10 max-w-2xl mx-auto flex flex-col items-center gap-6">
          <div className="w-16 h-16 rounded-full bg-gold/10 border border-gold/25 flex items-center justify-center">
            <svg className="w-8 h-8 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>

          <h1 className="text-4xl sm:text-5xl font-light tracking-tight text-charcoal">
            The Grand Azure
          </h1>
          <p className="text-gold text-sm tracking-[0.25em] uppercase font-medium">
            Hotel & Residences — Singapore
          </p>
          <p className="text-warm-gray text-lg leading-relaxed max-w-lg">
            Experience luxury overlooking Marina Bay. Book your stay and enjoy world-class amenities
            with our seamless AI-powered check-in.
          </p>

          <Link
            href="/book"
            className="mt-4 px-10 py-4 bg-gold text-white text-sm font-medium tracking-wide rounded-lg hover:bg-gold-dark transition-colors shadow-sm"
          >
            Book Your Stay
          </Link>
        </div>
      </section>

      {/* Features strip */}
      <section className="border-t border-warm-gray-lighter bg-white py-16 px-6">
        <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-10 text-center">
          {[
            { title: 'Book Online', desc: 'Choose your room and dates in minutes', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
            { title: 'AI Check-in', desc: 'Skip the queue with our AI concierge kiosk', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
            { title: 'Instant Access', desc: 'Your digital key card ready in seconds', icon: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z' },
          ].map((feature) => (
            <div key={feature.title} className="flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-gold/8 flex items-center justify-center">
                <svg className="w-5 h-5 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={feature.icon} />
                </svg>
              </div>
              <h3 className="text-sm font-semibold tracking-wide text-charcoal">{feature.title}</h3>
              <p className="text-warm-gray text-sm">{feature.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
