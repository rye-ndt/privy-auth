import { Shield, ArrowRight, ExternalLink } from 'lucide-react'

export function HeroSection() {
  return (
    <section className="relative pt-32 pb-20 px-6 overflow-hidden flex flex-col items-center">
      {/* Background Glow */}
      <div className="absolute top-10 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-violet-600/20 rounded-full blur-[120px] pointer-events-none" />
      
      <div className="max-w-4xl mx-auto text-center relative z-10 flex flex-col items-center">
        {/* App Logo / Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 mb-8 backdrop-blur-md cursor-pointer hover:bg-white/10 transition-colors">
          <img src="/logo.png" alt="Aegis Logo" className="w-5 h-5 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling!.classList.remove('hidden'); }} />
          <Shield className="w-4 h-4 text-violet-400 hidden" />
          <span className="text-sm font-medium text-white/80">Aegis</span>
        </div>

        <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 bg-gradient-to-br from-white to-white/60 bg-clip-text text-transparent leading-tight">
          Chat with your money.
        </h1>
        
        <p className="text-xl md:text-2xl text-white/60 mb-10 max-w-3xl font-light leading-relaxed">
          Tapping into Telegram's 900M users with invisible account abstraction and agentic DeFi. <br/> <strong className="text-white/90 font-semibold mt-2 block">We turn any chat into a fully-functional, non-custodial smart account.</strong>
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
          <a href="https://t.me/AegisWalletBot" target="_blank" rel="noreferrer" className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-white text-gray-900 font-semibold text-lg hover:bg-white/90 active:scale-95 transition-all duration-200 shadow-[0_8px_32px_rgba(124,58,237,0.3)] hover:shadow-[0_8px_40px_rgba(124,58,237,0.45)] hover:-translate-y-0.5 flex items-center justify-center gap-2">
            Open in Telegram
            <ArrowRight className="w-5 h-5" />
          </a>
          
          <a href="mailto:aegis.helper@gmail.com" className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-white/5 text-white border border-white/10 font-semibold text-lg hover:bg-white/10 active:scale-95 transition-all duration-200 flex items-center justify-center gap-2">
            For investors & partners
            <ExternalLink className="w-5 h-5 text-white/50" />
          </a>
        </div>
      </div>

      {/* Trust Strip */}
      <div className="w-full max-w-5xl mx-auto mt-24 pt-8 border-t border-white/10">
        <div className="flex flex-wrap justify-center gap-8 md:gap-16 text-sm font-medium text-white/40">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500/80" />
            Your keys never leave your device
          </div>
          <div className="flex items-center gap-2">
            Backed by Top Investors
          </div>
          <div className="flex items-center gap-2">
            Audited by Tier-1 Firms
          </div>
          <div className="flex items-center gap-2">
            Live on Avalanche
          </div>
        </div>
      </div>
    </section>
  )
}
