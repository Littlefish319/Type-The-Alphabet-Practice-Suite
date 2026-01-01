import React, { useEffect } from 'react';

const COMPANY = 'YUNOVA, LLC';
const CONTACT_EMAIL = 'contact@yunova.org';

export default function YunovaLanding() {
  useEffect(() => {
    document.title = `${COMPANY}`;

    const upsertMeta = (name: string, content: string) => {
      const existing = document.head.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
      if (existing) {
        existing.content = content;
        return;
      }
      const meta = document.createElement('meta');
      meta.name = name;
      meta.content = content;
      document.head.appendChild(meta);
    };

    upsertMeta(
      'description',
      'YUNOVA, LLC builds focused learning tools. AlphaTyper is an upcoming typing practice app with optional cloud sync.'
    );
  }, []);

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-slate-50 via-white to-slate-50 text-slate-900">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <header className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-500" />
            <div>
              <div className="text-sm font-black tracking-wide text-slate-700">{COMPANY}</div>
              <div className="text-xs font-semibold text-slate-500">Product studio · Learning tools</div>
            </div>
          </div>
          <a
            className="text-sm font-bold text-slate-700 hover:text-slate-900 underline"
            href={`mailto:${CONTACT_EMAIL}`}
          >
            {CONTACT_EMAIL}
          </a>
        </header>

        <main className="mt-14">
          <div className="max-w-3xl">
            <h1 className="text-4xl sm:text-5xl font-black tracking-tight">
              Building simple, high-signal apps.
            </h1>
            <p className="mt-5 text-lg text-slate-600 leading-relaxed">
              YUNOVA, LLC creates focused learning products with clean design and measurable progress.
            </p>
          </div>

          <section className="mt-12 rounded-3xl border border-slate-200 bg-white/80 backdrop-blur p-7 shadow-xl">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
              <div>
                <div className="text-xs font-black uppercase tracking-widest text-slate-400">Now launching</div>
                <h2 className="mt-2 text-2xl font-black tracking-tight">AlphaTyper</h2>
                <p className="mt-3 text-slate-600 leading-relaxed">
                  A modern alphabet typing practice suite with analytics and an optional account system for cloud sync across devices.
                </p>
                <div className="mt-4 text-sm text-slate-500">
                  Support: <a className="underline" href="https://alphatyper.vercel.app/support.html" target="_blank" rel="noreferrer">alphatyper.vercel.app/support.html</a>
                  {' · '}Privacy: <a className="underline" href="https://alphatyper.vercel.app/privacy.html" target="_blank" rel="noreferrer">alphatyper.vercel.app/privacy.html</a>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <a
                  className="inline-flex items-center justify-center rounded-2xl px-5 py-3 font-black text-white bg-gradient-to-r from-blue-600 to-cyan-500 shadow hover:opacity-95 transition"
                  href="https://alphatyper.vercel.app"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open AlphaTyper
                </a>
                <a
                  className="inline-flex items-center justify-center rounded-2xl px-5 py-3 font-black text-slate-800 bg-slate-100 border border-slate-200 hover:bg-slate-200 transition"
                  href={`mailto:${CONTACT_EMAIL}`}
                >
                  Contact
                </a>
              </div>
            </div>
          </section>

          <section className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="text-sm font-black">Focused</div>
              <div className="mt-2 text-sm text-slate-600">Minimal features, maximum clarity.</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="text-sm font-black">Privacy-minded</div>
              <div className="mt-2 text-sm text-slate-600">Cloud sync is optional; local-first by default.</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="text-sm font-black">Cross-device</div>
              <div className="mt-2 text-sm text-slate-600">Designed for iPhone, iPad, and web.</div>
            </div>
          </section>

          <footer className="mt-14 border-t border-slate-200 pt-8 text-sm text-slate-500 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>© {new Date().getFullYear()} {COMPANY}. All rights reserved.</div>
            <div className="flex gap-4">
              <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>Email</a>
              <a className="underline" href="https://alphatyper.vercel.app" target="_blank" rel="noreferrer">AlphaTyper</a>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
