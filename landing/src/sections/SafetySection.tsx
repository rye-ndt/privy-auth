import { Key, ShieldAlert, CheckCircle2, ExternalLink, ShieldCheck } from 'lucide-react'

export function SafetySection() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-4xl mx-auto text-center">
        <h2 className="text-4xl font-bold tracking-tight mb-4">How it stays <span className="text-green-400">safe.</span></h2>
        <p className="text-xl text-white/50 mb-16 max-w-2xl mx-auto">
          Security isn't a feature, it's the foundation. We built Aegis so you never have to compromise between convenience and safety.
        </p>

        <div className="grid md:grid-cols-3 gap-8 text-left mb-16">
          <div className="space-y-4 p-6 rounded-3xl bg-white/[0.02] border border-white/5 hover:border-white/10 hover:bg-white/5 active:scale-[0.98] cursor-pointer transition-all duration-200">
            <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center text-green-400">
              <Key className="w-5 h-5" />
            </div>
            <h4 className="text-lg font-semibold text-white">You hold the keys</h4>
            <p className="text-sm text-white/50 leading-relaxed">
              Session keys live securely on your device. Aegis can never move funds you didn't explicitly approve.
            </p>
          </div>
          
          <div className="space-y-4 p-6 rounded-3xl bg-white/[0.02] border border-white/5 hover:border-white/10 hover:bg-white/5 active:scale-[0.98] cursor-pointer transition-all duration-200">
            <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <h4 className="text-lg font-semibold text-white">Aegis Guard</h4>
            <p className="text-sm text-white/50 leading-relaxed">
              Set spending limits. "Only allow swaps up to $100 for 7 days" — enforced on-chain, not just in software.
            </p>
          </div>

          <div className="space-y-4 p-6 rounded-3xl bg-white/[0.02] border border-white/5 hover:border-white/10 hover:bg-white/5 active:scale-[0.98] cursor-pointer transition-all duration-200">
            <div className="w-10 h-10 rounded-full bg-violet-500/20 flex items-center justify-center text-violet-400">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <h4 className="text-lg font-semibold text-white">Verified Registry</h4>
            <p className="text-sm text-white/50 leading-relaxed">
              No spoofed tokens. No scam approvals. Aegis only interacts with a curated registry of verified smart contracts.
            </p>
          </div>
        </div>

        {/* The Problem with Custodial Bots */}
        <div className="text-left mt-8">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-medium mb-6">
            <ShieldAlert className="w-4 h-4" />
            The Custodial Bot Epidemic
          </div>
          <h3 className="text-2xl md:text-3xl font-bold tracking-tight mb-8">Why standard Telegram bots get drained.</h3>
          
          <div className="grid md:grid-cols-2 gap-6">
            <div className="p-6 rounded-3xl bg-red-500/5 border border-red-500/10 flex flex-col">
              <h4 className="text-lg font-semibold text-white mb-3">The Flaw: Giving Up Your Keys</h4>
              <p className="text-sm text-white/60 mb-6 leading-relaxed flex-1">
                Traditional bots require you to import your private key or generate a wallet on their servers. If their smart contracts or servers are compromised, attackers have total control to drain every connected wallet.
              </p>
              <div className="space-y-3 mt-auto">
                <a href="https://rekt.news/unibot-rekt/" target="_blank" rel="noreferrer" className="flex items-center justify-between p-4 rounded-2xl bg-white/5 hover:bg-white/10 transition-colors border border-white/5 cursor-pointer">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-white/90">Unibot Hack</span>
                    <span className="text-xs text-red-400 font-medium">$600,000 drained</span>
                  </div>
                  <ExternalLink className="w-4 h-4 text-white/40" />
                </a>
                <a href="https://beincrypto.com/maestro-telegram-bot-hacked/" target="_blank" rel="noreferrer" className="flex items-center justify-between p-4 rounded-2xl bg-white/5 hover:bg-white/10 transition-colors border border-white/5 cursor-pointer">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-white/90">Maestro Bot Hack</span>
                    <span className="text-xs text-red-400 font-medium">280 ETH drained</span>
                  </div>
                  <ExternalLink className="w-4 h-4 text-white/40" />
                </a>
              </div>
            </div>

            <div className="p-6 rounded-3xl bg-green-500/5 border border-green-500/10 flex flex-col">
              <h4 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-green-400" />
                The Aegis Solution: Delegation
              </h4>
              <p className="text-sm text-white/60 mb-6 leading-relaxed">
                Aegis never asks for your private key. Instead, you create a Smart Contract Account and grant the Aegis AI agent a <strong>temporary, cryptographically restricted Session Key</strong>.
              </p>
              <div className="space-y-4 mt-auto">
                <div className="flex items-start gap-3 p-4 rounded-2xl bg-black/20 border border-white/5">
                  <CheckCircle2 className="w-5 h-5 text-green-400 mt-0.5 shrink-0" />
                  <p className="text-sm text-white/80 leading-relaxed">
                    <strong className="text-white">Strict Spending Limits:</strong> The agent can only spend exactly what you approve (e.g., $100 per week).
                  </p>
                </div>
                <div className="flex items-start gap-3 p-4 rounded-2xl bg-black/20 border border-white/5">
                  <CheckCircle2 className="w-5 h-5 text-green-400 mt-0.5 shrink-0" />
                  <p className="text-sm text-white/80 leading-relaxed">
                    <strong className="text-white">Mathematically Impossible to Drain:</strong> Even if our servers are completely compromised, the blockchain itself rejects any transaction exceeding your limits.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </section>
  )
}
