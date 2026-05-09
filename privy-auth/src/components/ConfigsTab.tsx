import React from "react";
import { useDelegations, type GrantPermission } from "../hooks/useAppData";

export function ConfigsTab({
  eoaAddress,
  smartAddress,
  delegatedAddress,
  removeKey,
}: {
  eoaAddress: string;
  smartAddress: string;
  delegatedAddress: string | null;
  removeKey: () => Promise<void>;
}) {
  const [showModal, setShowModal] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const [removed, setRemoved] = React.useState(false);
  const { refetch: refetchDelegations } = useDelegations();

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await removeKey();
      setRemoved(true);
      setShowModal(false);
      refetchDelegations();
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="flex flex-col gap-7 px-4 pt-10 pb-28">
      <div className="flex flex-col gap-4">
        <SectionLabel>Your Wallet</SectionLabel>
        {smartAddress && (
          <AddressCard
            label="Main Wallet"
            desc="receives funds"
            address={smartAddress}
          />
        )}
        <AddressCard label="Backup Wallet" desc="for advanced use" address={eoaAddress} />
      </div>

      <div className="flex flex-col gap-4">
        <SectionLabel>Your Bot</SectionLabel>

        {delegatedAddress ? (
          <AddressCard
            label="Bot Address"
            desc="trades for you"
            address={delegatedAddress}
          />
        ) : (
          <div className="flex items-center gap-3 bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3.5">
            <div className="w-1.5 h-1.5 flex-shrink-0 rounded-full bg-white/15" />
            <p className="text-xs text-white/25">No bot connected</p>
          </div>
        )}

        {removed ? (
          <div className="flex items-center gap-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl px-4 py-3.5">
            <div className="w-1.5 h-1.5 flex-shrink-0 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
            <p className="text-xs text-emerald-400">
              Bot disconnected — reload to reconnect
            </p>
          </div>
        ) : (
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-white/80 mb-1">
                  Disconnect Bot
                </p>
                <p className="text-[11px] text-white/35 leading-relaxed">
                  Stop the bot from automatically running trades and
                  transactions for you.
                </p>
              </div>
              <button
                onClick={() => setShowModal(true)}
                className="flex-shrink-0 mt-0.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] font-semibold hover:bg-red-500/15 transition-colors"
              >
                Disconnect
              </button>
            </div>
          </div>
        )}
      </div>

      <PermissionsSection />

      {showModal && (
        <RemoveBotModal
          onConfirm={handleRemove}
          onCancel={() => setShowModal(false)}
          loading={removing}
        />
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold tracking-widest text-white/20 uppercase px-0.5">
      {children}
    </p>
  );
}

function AddressCard({
  label,
  desc,
  address,
}: {
  label: string;
  desc?: string;
  address: string;
}) {
  const [copied, setCopied] = React.useState(false);

  const copy = () => {
    navigator.clipboard?.writeText(address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between mb-1.5 px-0.5">
        <p className="text-[10px] font-semibold tracking-widest text-white/30 uppercase">
          {label}
        </p>
        {desc && <p className="text-[10px] text-white/20">{desc}</p>}
      </div>
      <button
        onClick={copy}
        className="w-full flex items-center gap-3 bg-white/5 hover:bg-white/[0.08] border border-white/10 rounded-xl px-4 py-3.5 transition-colors text-left group"
      >
        <div className="w-1.5 h-1.5 flex-shrink-0 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
        <p className="font-mono text-xs text-white/80 break-all flex-1 min-w-0">
          {address}
        </p>
        <span className="text-[11px] flex-shrink-0 transition-colors text-white/20 group-hover:text-violet-400">
          {copied ? "✓" : "copy"}
        </span>
      </button>
    </div>
  );
}

function PermissionsSection() {
  const { data: grants, loading, error } = useDelegations();

  return (
    <div className="flex flex-col gap-3">
      <SectionLabel>What the bot can do</SectionLabel>

      {loading && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="h-16 bg-white/[0.03] border border-white/[0.05] rounded-xl animate-pulse"
            />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center justify-center h-14 bg-white/[0.03] border border-white/[0.05] rounded-xl">
          <p className="text-[11px] text-white/25">{error}</p>
        </div>
      )}

      {!loading && !error && grants?.length === 0 && (
        <div className="flex items-center justify-center h-14 bg-white/[0.03] border border-white/[0.05] rounded-xl">
          <p className="text-[11px] text-white/25">
            No spending caps set
          </p>
        </div>
      )}

      {!loading && !error && grants && grants.length > 0 && (
        <div className="flex flex-col gap-2">
          {grants.map((g, i) => (
            <GrantRow key={i} grant={g} />
          ))}
        </div>
      )}
    </div>
  );
}

function GrantRow({ grant }: { grant: GrantPermission }) {
  const truncateAddr = (addr: string) =>
    addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;

  const scaleRaw = (raw: string | undefined, decimals: number | undefined) => {
    if (raw == null) return null;
    try {
      const n = Number(BigInt(raw)) / 10 ** (decimals ?? 0);
      return Number.isFinite(n) ? n : null;
    } catch {
      const n = parseFloat(raw);
      return Number.isFinite(n) ? n / 10 ** (decimals ?? 0) : null;
    }
  };

  const formatAmount = (n: number | null) => {
    if (n == null) return "—";
    return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  };

  const formatExpiry = (ts: number | undefined) => {
    if (!ts) return null;
    return new Date(ts * 1000).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const label = grant.tokenSymbol ?? truncateAddr(grant.tokenAddress ?? "");
  const expiry = formatExpiry(grant.validUntil);
  const isExpired =
    grant.validUntil != null && grant.validUntil * 1000 < Date.now();
  const spent = scaleRaw(grant.spentRaw, grant.tokenDecimals);
  const max = scaleRaw(grant.limitRaw, grant.tokenDecimals);
  const pct =
    spent != null && max != null && max > 0
      ? Math.min(100, (spent / max) * 100)
      : null;

  return (
    <div
      className={`bg-white/[0.03] border rounded-xl px-4 py-3.5 flex flex-col gap-2 ${isExpired ? "border-white/[0.05] opacity-50" : "border-white/[0.07]"}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-violet-500/10 border border-violet-500/15 flex items-center justify-center">
            <span className="text-[8px] font-bold text-violet-400">
              {(grant.tokenSymbol ?? "?").slice(0, 3).toUpperCase()}
            </span>
          </div>
          <p className="text-xs font-bold text-white/90">{label}</p>
        </div>
        {isExpired && (
          <span className="text-[9px] text-red-400/70 font-semibold uppercase tracking-wide">
            Expired
          </span>
        )}
      </div>

      <div className="flex items-center justify-between text-[11px]">
        <span className="text-white/35">Spending cap</span>
        <span className="text-white/65 font-mono">
          {formatAmount(max)}{grant.tokenSymbol ? <> <span className="font-bold text-white/80">{grant.tokenSymbol}</span></> : ""}
        </span>
      </div>

      {pct !== null && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-white/25">Used</span>
            <span className="text-white/40">{pct.toFixed(1)}%</span>
          </div>
          <div className="h-1 bg-white/[0.06] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${pct > 80 ? "bg-red-400/60" : "bg-violet-400/60"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {expiry && (
        <p className="text-[10px] text-white/25">
          {isExpired ? "Expired" : "Expires"} {expiry}
        </p>
      )}
    </div>
  );
}

function RemoveBotModal({
  onConfirm,
  onCancel,
  loading,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center pb-8 px-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={!loading ? onCancel : undefined}
      />
      <div className="relative w-full max-w-sm bg-[#161624] border border-white/10 rounded-2xl p-6 flex flex-col gap-5 shadow-[0_-8px_40px_rgba(0,0,0,0.5)]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#f87171"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div>
            <p className="text-white font-semibold text-sm">
              Disconnect Bot?
            </p>
            <p className="text-white/40 text-[11px] mt-0.5">
              This cannot be undone from here
            </p>
          </div>
        </div>

        <p className="text-white/60 text-[13px] leading-relaxed">
          The bot will no longer be able to run transactions for you
          automatically. You'll need to reconnect it the next time you open
          Aegis.
        </p>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-3 rounded-xl border border-white/10 text-white/70 text-sm font-medium hover:bg-white/5 transition-colors disabled:opacity-40"
          >
            Keep Connected
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm font-semibold hover:bg-red-500/20 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {loading ? (
              <div className="w-4 h-4 rounded-full border-2 border-red-400/30 border-t-red-400 animate-spin" />
            ) : (
              "Disconnect"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
