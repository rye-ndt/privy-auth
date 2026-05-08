import { usePrivy } from "@privy-io/react-auth";
import { GoogleIcon, ShieldIcon } from "../atomics/icons";

export function LoginView() {
  const { login, ready } = usePrivy();

  return (
    <div className="flex flex-col items-center justify-between w-full min-h-dvh bg-[#0f0f1a] px-6 py-12">
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="relative mb-10">
          <div className="absolute inset-0 rounded-full bg-violet-600/30 blur-3xl scale-[2.5]" />
          <div className="relative flex items-center justify-center w-24 h-24 rounded-3xl bg-gradient-to-br from-violet-600/20 to-indigo-600/20 border border-violet-500/20">
            <ShieldIcon />
          </div>
        </div>
        <h1 className="text-3xl font-bold text-white tracking-tight mb-2">
          Aegis
        </h1>
        <p className="text-base text-white/40 text-center max-w-[220px] leading-relaxed">
          Your secure account, powered by Google
        </p>
      </div>

      <div className="w-full max-w-sm flex flex-col gap-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex-1 h-px bg-white/[0.08]" />
          <span className="text-xs text-white/25 font-medium">Get started</span>
          <div className="flex-1 h-px bg-white/[0.08]" />
        </div>

        <button
          onClick={login}
          disabled={!ready}
          className="
            group flex items-center justify-center gap-3
            w-full py-4 px-6 rounded-2xl
            bg-white hover:bg-white/95 active:bg-white/90
            text-gray-800 font-semibold text-[15px]
            transition-all duration-150
            shadow-[0_8px_32px_rgba(124,58,237,0.3)]
            hover:shadow-[0_8px_40px_rgba(124,58,237,0.45)]
            active:scale-[0.98]
            disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100
          "
        >
          <GoogleIcon />
          Continue with Google
        </button>

        <p className="text-center text-[11px] text-white/20 leading-relaxed px-2">
          An account is created for you automatically.
        </p>
      </div>
    </div>
  );
}
