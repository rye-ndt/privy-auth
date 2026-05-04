import type { TransferDirection } from '../../types/transferHistory.types';

type FilterValue = TransferDirection | undefined;

const OPTIONS: { id: FilterValue; label: string }[] = [
  { id: undefined, label: 'All' },
  { id: 'out',     label: 'Sent' },
  { id: 'in',      label: 'Received' },
];

export function DirectionFilter({
  value,
  onChange,
}: {
  value: FilterValue;
  onChange: (v: FilterValue) => void;
}) {
  return (
    <div className="flex items-center gap-1 bg-white/[0.04] border border-white/[0.07] rounded-xl p-1 w-fit">
      {OPTIONS.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.label}
            onClick={() => onChange(opt.id)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold tracking-wide transition-all ${
              active
                ? 'bg-violet-500/20 text-violet-300'
                : 'text-white/40 hover:text-white/70'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
