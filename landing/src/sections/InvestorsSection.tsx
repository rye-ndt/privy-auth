import { ArrowRight } from 'lucide-react'

export function InvestorsSection() {
  return (
    <section className="py-24 px-6 border-y border-white/10 bg-[#0a0a14]">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col md:flex-row items-baseline justify-between mb-12 border-b border-white/10 pb-6">
          <h2 className="text-3xl font-bold tracking-tight text-white/90">Join the Next Wave of DeFi</h2>
          <span className="text-sm font-medium text-white/40 uppercase tracking-widest mt-4 md:mt-0">Executive Summary</span>
        </div>

        <div className="grid md:grid-cols-2 gap-16">
          {/* Left: Thesis */}
          <div className="space-y-10 text-white/70">
            <div>
              <h4 className="text-lg font-semibold text-white mb-2">The Market</h4>
              <p className="leading-relaxed text-sm">
                Telegram has 900M+ MAUs. Meanwhile, billions in stablecoin supply sits idle due to UX friction. Aegis bridges this gap by turning the chat interface into a fully functional, non-custodial smart account.
              </p>
            </div>

            <div>
              <h4 className="text-lg font-semibold text-white mb-2">The Wedge</h4>
              <p className="leading-relaxed text-sm">
                Chat-native UX + non-custodial security. Neither incumbents (CEX bots require surrendering keys) nor wallets (require app downloads and seed phrases) offer both.
              </p>
            </div>

            <div>
              <h4 className="text-lg font-semibold text-white mb-2">The Moat</h4>
              <p className="leading-relaxed text-sm">
                Our modular Capability framework and Semantic Router turn every new DeFi tool into a vector-indexed plugin. This third-party ecosystem is our long-term defensibility.
              </p>
            </div>
          </div>

          {/* Right: Traction & Roadmap */}
          <div className="space-y-10">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                <div className="text-2xl font-bold text-white mb-1">—</div>
                <div className="text-xs text-white/40 uppercase tracking-wider">Live Users</div>
              </div>
              <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                <div className="text-2xl font-bold text-white mb-1">—</div>
                <div className="text-xs text-white/40 uppercase tracking-wider">Yield AUM</div>
              </div>
              <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                <div className="text-xl font-bold text-white mb-1">Avalanche</div>
                <div className="text-xs text-white/40 uppercase tracking-wider">Chains Supported</div>
              </div>
              <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                <div className="text-xl font-bold text-white mb-1">Pre-launch</div>
                <div className="text-xs text-white/40 uppercase tracking-wider">Status</div>
              </div>
            </div>

            <div>
              <h4 className="text-lg font-semibold text-white mb-4">The Ask & Current Status</h4>
              <p className="leading-relaxed text-sm text-white/70">
                Aegis is currently in closed beta. We are raising our next round to expand the engineering team, accelerate the rollout of our third-party Capabilities marketplace, and scale our infrastructure to Base, Arbitrum, and Polygon.
              </p>
            </div>

            <button className="flex items-center justify-between w-full p-4 rounded-xl bg-white/10 hover:bg-white/15 active:scale-[0.98] transition-all duration-200 border border-white/10 text-white font-medium cursor-pointer">
              Request Deck / Contact Us
              <ArrowRight className="w-4 h-4 text-white/50" />
            </button>
          </div>

        </div>
      </div>
    </section>
  )
}
