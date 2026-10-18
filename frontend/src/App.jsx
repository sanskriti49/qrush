import { useState, useEffect } from 'react'
import { Zap, Users, ShieldCheck, Activity, Clock, CheckCircle2 } from 'lucide-react'

export default function App() {
  const [health, setHealth] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/health')
      .then(res => res.json())
      .then(data => {
        setHealth(data)
        setLoading(false)
      })
      .catch(() => {
        setHealth(null)
        setLoading(false)
      })
  }, [])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-amber-500 selection:text-black">
      {/* Top Navbar */}
      <header className="border-b border-slate-800/80 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 to-rose-500 flex items-center justify-center font-black text-black shadow-lg shadow-amber-500/20">
              <Zap className="w-6 h-6 fill-black" />
            </div>
            <div>
              <span className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">
                QRush
              </span>
              <span className="ml-2 text-xs font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                v0.1 Engine
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 text-sm">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900">
              <Activity className="w-4 h-4 text-emerald-400 animate-pulse" />
              <span className="text-xs text-slate-400">Spring Boot Backend:</span>
              {loading ? (
                <span className="text-xs font-mono text-slate-500">Connecting...</span>
              ) : health?.status === 'UP' ? (
                <span className="text-xs font-mono font-semibold text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> ONLINE
                </span>
              ) : (
                <span className="text-xs font-mono text-rose-400">OFFLINE (Run Backend)</span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Hero / Showcase Section */}
      <main className="max-w-6xl mx-auto px-4 py-12 flex-1 w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        {/* Left Column: Pitch */}
        <div className="lg:col-span-7 space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs font-medium text-slate-300">
            <ShieldCheck className="w-4 h-4 text-amber-400" />
            Zero Race Conditions • Redis Lua Atomic Locks • SSE Waiting Room
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-tight">
            Crash-proof flash drops for{' '}
            <span className="bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 bg-clip-text text-transparent">
              high-demand sales
            </span>
            .
          </h1>

          <p className="text-slate-400 text-lg leading-relaxed max-w-xl">
            Engineered to absorb 5,000 requests/second without database deadlocks. Token-bucket rate limiting, live position streaming, and atomic 5-minute inventory holds.
          </p>

          <div className="grid grid-cols-3 gap-4 pt-2 max-w-md">
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="text-2xl font-bold font-mono text-amber-400">5,000+</div>
              <div className="text-xs text-slate-400 mt-1">Req/sec target</div>
            </div>
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="text-2xl font-bold font-mono text-emerald-400">&lt; 2ms</div>
              <div className="text-xs text-slate-400 mt-1">Redis Lua latency</div>
            </div>
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="text-2xl font-bold font-mono text-orange-400">0%</div>
              <div className="text-xs text-slate-400 mt-1">Double bookings</div>
            </div>
          </div>
        </div>

        {/* Right Column: Live Mock Card */}
        <div className="lg:col-span-5">
          <div className="p-6 rounded-2xl bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-amber-400" />
                <span className="font-semibold text-sm">Virtual Waiting Room</span>
              </div>
              <span className="flex items-center gap-1.5 text-xs font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" /> LIVE
              </span>
            </div>

            <div className="py-8 text-center space-y-2">
              <div className="text-xs uppercase tracking-widest font-mono text-slate-500">Your Place in Line</div>
              <div className="text-6xl font-black font-mono text-amber-400 tracking-tight">#142</div>
              <div className="flex items-center justify-center gap-1.5 text-xs text-slate-400 pt-2">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                Estimated wait: <span className="font-mono text-slate-200">~38 seconds</span>
              </div>
            </div>

            {/* Progress bar */}
            <div className="space-y-1.5 pt-2">
              <div className="flex justify-between text-xs font-mono text-slate-400">
                <span>Remaining Tickets</span>
                <span className="text-amber-400">78 / 250</span>
              </div>
              <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-amber-500 to-rose-500 w-[31%] rounded-full transition-all duration-500" />
              </div>
            </div>

            <div className="mt-6 p-3 rounded-lg bg-slate-950 border border-slate-800/80 text-xs text-slate-400 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Cryptographic token verified. Do not refresh this page.</span>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 py-6 text-center text-xs text-slate-500">
        QRush • High-Concurrency Architecture with Java 21, Spring Boot, Redis & React
      </footer>
    </div>
  )
}
