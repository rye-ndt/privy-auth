export function DemoSection() {
  return (
    <section className="py-24 px-6 border-y border-white/5 bg-black/20">
      <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center gap-16">
        
        {/* Left: Copy */}
        <div className="flex-1 space-y-8">
          <h2 className="text-4xl font-bold tracking-tight">Tell it what you want. <br/><span className="text-violet-400">It just happens.</span></h2>
          
          <div className="space-y-6">
            <div className="flex gap-4">
              <div className="w-1.5 rounded-full bg-violet-500" />
              <div>
                <h4 className="font-semibold text-lg text-white">Transfer to <span className="text-violet-400">@handle</span></h4>
                <p className="text-white/50">"Send $20 to @alex" → Confirmation → Done. No 0x addresses needed.</p>
              </div>
            </div>
            
            <div className="flex gap-4">
              <div className="w-1.5 rounded-full bg-indigo-500" />
              <div>
                <h4 className="font-semibold text-lg text-white">Swap Tokens</h4>
                <p className="text-white/50">"Swap 100 USDC to ETH" → One tap execution.</p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="w-1.5 rounded-full bg-blue-500" />
              <div>
                <h4 className="font-semibold text-lg text-white flex items-center gap-2">Auto-Compound Yield <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-blue-500/20 text-blue-400">Agentic</span></h4>
                <p className="text-white/50">"Put my idle cash to work." Your AI agent proactively finds the best safe yield for your stablecoins and manages it for you.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Mock UI */}
        <div className="flex-1 w-full max-w-md">
          <div className="apple-intelligence-glow rounded-3xl">
            <div className="rounded-3xl border border-white/5 bg-[#1c1c28] overflow-hidden shadow-2xl relative w-full h-full z-10">
              <div className="h-12 border-b border-white/5 flex items-center px-4 gap-3 bg-white/5">
                <div className="w-3 h-3 rounded-full bg-red-500/80" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                <div className="w-3 h-3 rounded-full bg-green-500/80" />
                <span className="text-xs font-medium text-white/30 ml-4">Aegis Bot</span>
              </div>
              
              <div className="p-6 space-y-6 h-[400px] flex flex-col justify-end bg-gradient-to-b from-transparent to-violet-900/10 relative z-20">
                {/* Agent Message */}
                <div className="flex flex-col gap-1 items-start relative z-10">
                  <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-white/10 text-sm text-white/90 max-w-[85%] backdrop-blur-md">
                    You have $300 idle earning 0%. Want to earn 4.8% APY on Aave?
                  </div>
                </div>

                {/* User Message */}
                <div className="flex flex-col gap-1 items-end relative z-10">
                  <div className="px-4 py-3 rounded-2xl rounded-tr-sm bg-violet-600 text-sm text-white max-w-[85%] shadow-lg shadow-violet-500/20">
                    Yes, deposit it.
                  </div>
                </div>

                {/* Agent UI Widget */}
                <div className="flex flex-col gap-1 items-start relative z-10">
                  <div className="p-4 rounded-2xl rounded-tl-sm bg-white/5 border border-white/10 max-w-[85%] w-full space-y-3 backdrop-blur-xl">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-white/60">Deposit to Aave</span>
                      <span className="font-medium">300 USDC</span>
                    </div>
                    <button className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 transition-all duration-200 text-sm font-medium text-center cursor-pointer border border-white/5">
                      Tap to Confirm
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
      </div>
    </section>
  )
}
