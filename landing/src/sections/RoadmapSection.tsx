import {
  ArrowRight,
  Database,
  GitBranch,
  LineChart,
  Lock,
  Rocket,
  ShieldCheck,
  Target,
  Zap,
} from "lucide-react";

export function RoadmapSection() {
  const nodes = [
    {
      id: 1,
      title: "ZeroDev & Privy Auth",
      category: "Infrastructure",
      description:
        "Invisible account abstraction. Users login with Telegram or FaceID. No seed phrases, fully non-custodial.",
      icon: <ShieldCheck className="w-5 h-5" />,
      status: "live",
      alignment: "left",
    },
    {
      id: 2,
      title: "Semantic Intent Router",
      category: "Core AI",
      description:
        "Translates plain English into deterministic on-chain actions. Extensible plugin architecture.",
      icon: <Database className="w-5 h-5" />,
      status: "live",
      alignment: "right",
    },
    {
      id: 3,
      title: "Cross-chain Swaps",
      category: "Operations",
      description:
        "Instant liquidity routing via Relay. Move value across chains without touching a bridge.",
      icon: <Zap className="w-5 h-5" />,
      status: "live",
      alignment: "left",
    },
    {
      id: 4,
      title: "Auto-rebalancing Yield",
      category: "Earn",
      description:
        "Aave v3 integration that automatically compounds and rebalances idle stablecoins for maximum APY.",
      icon: <LineChart className="w-5 h-5" />,
      status: "live",
      alignment: "right",
    },
    {
      id: 5,
      title: "Aegis Guard",
      category: "Security",
      description:
        "On-chain spending limits and delegated session keys. You control exactly what the AI can spend.",
      icon: <Lock className="w-5 h-5" />,
      status: "live",
      alignment: "left",
    },
    {
      id: 6,
      title: "Tokenized Stocks",
      category: "Trading",
      description:
        "Trade AAPL, TSLA, and more directly from Telegram via the Aster perp DEX on BSC.",
      icon: <Target className="w-5 h-5" />,
      status: "live",
      alignment: "right",
    },
    {
      id: 7,
      title: "Prediction Markets",
      category: "Upcoming",
      description:
        "Kalshi integration. Bet on real-world events and elections natively within the chat interface.",
      icon: <Rocket className="w-5 h-5 text-violet-400" />,
      status: "upcoming",
      alignment: "left",
    },
    {
      id: 8,
      title: "Leverage Perp DEX",
      category: "Upcoming",
      description:
        "Advanced margin trading via Aster. High-leverage crypto and synthetic assets directly in Telegram.",
      icon: <Rocket className="w-5 h-5 text-violet-400" />,
      status: "upcoming",
      alignment: "right",
    },
  ];

  return (
    <section className="py-24 px-6 relative overflow-hidden bg-white/[0.01] border-y border-white/5">
      {/* Background elements */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-violet-600/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="max-w-5xl mx-auto relative z-10">
        <div className="text-center mb-20">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 text-sm font-medium mb-6">
            <GitBranch className="w-4 h-4" />
            Product Tree & Roadmap
          </div>
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-6">
            Built for scale. <br />
            Designed for users.
          </h2>
          <p className="text-lg text-white/50 max-w-2xl mx-auto">
            Our modular architecture turns complex DeFi primitives into simple
            chat commands. Here is what we have built, and where we are going.
          </p>
        </div>

        {/* Tree Layout */}
        <div className="relative max-w-4xl mx-auto">
          {/* Central Stem */}
          <div className="absolute left-4 md:left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-violet-500/0 via-violet-500/50 to-violet-500/0 md:-translate-x-1/2" />

          <div className="space-y-12 md:space-y-24">
            {nodes.map((node) => {
              const isLeft = node.alignment === "left";
              const isUpcoming = node.status === "upcoming";

              return (
                <div
                  key={node.id}
                  className={`relative flex flex-col md:flex-row items-center gap-8 ${isLeft ? "md:flex-row-reverse" : ""}`}
                >
                  {/* Timeline Dot */}
                  <div
                    className="absolute left-4 md:left-1/2 w-4 h-4 rounded-full border-4 border-[#0f0f1a] md:-translate-x-1/2 z-10 flex items-center justify-center shrink-0"
                    style={{ background: isUpcoming ? "#a78bfa" : "#8b5cf6" }}
                  >
                    {isUpcoming && (
                      <div className="absolute inset-0 rounded-full animate-ping bg-violet-400 opacity-75" />
                    )}
                  </div>

                  {/* Branch Line (Desktop only) */}
                  <div
                    className={`hidden md:block absolute top-1/2 w-[10%] h-px bg-violet-500/30 ${isLeft ? "right-[40%]" : "left-[40%]"}`}
                  />

                  {/* Empty space for the other side */}
                  <div className="hidden md:block w-1/2" />

                  {/* Content Card */}
                  <div
                    className={`w-full md:w-1/2 pl-12 md:pl-0 ${isLeft ? "md:pr-12 text-left md:text-right" : "md:pl-12 text-left"}`}
                  >
                    <div
                      className={`p-6 rounded-3xl border transition-all duration-300 hover:-translate-y-1 ${
                        isUpcoming
                          ? "bg-violet-900/10 border-violet-500/30 hover:bg-violet-900/20 hover:border-violet-500/50"
                          : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20"
                      }`}
                    >
                      <div
                        className={`flex items-center gap-3 mb-4 ${isLeft ? "md:flex-row-reverse" : ""}`}
                      >
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                            isUpcoming
                              ? "bg-violet-500/20"
                              : "bg-white/10 text-white/70"
                          }`}
                        >
                          {node.icon}
                        </div>
                        <div className="flex flex-col">
                          <span
                            className={`text-xs font-bold uppercase tracking-wider ${isUpcoming ? "text-violet-400" : "text-white/40"}`}
                          >
                            {node.category}
                          </span>
                          <h3 className="text-xl font-bold text-white/90">
                            {node.title}
                          </h3>
                        </div>
                      </div>

                      <p className="text-white/60 leading-relaxed text-sm">
                        {node.description}
                      </p>

                      {isUpcoming && (
                        <div
                          className={`mt-4 inline-flex items-center gap-2 text-sm font-medium text-violet-400 ${isLeft ? "md:flex-row-reverse" : ""}`}
                        >
                          In Development{" "}
                          <ArrowRight
                            className={`w-4 h-4 ${isLeft ? "md:rotate-180" : ""}`}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
