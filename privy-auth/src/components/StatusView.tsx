import React from 'react';
import type { DelegationState } from '../hooks/useDelegatedKey';
import { AppDataProvider } from '../hooks/useAppData';
import { HomeTab } from './HomeTab';
import { ConfigsTab } from './ConfigsTab';
import { DebugTab } from './DebugTab';
import { PointsTab } from './PointsTab';
import { ActivityTab } from './ActivityTab';

type Tab = 'home' | 'activity' | 'points' | 'configs' | 'debug';

export function StatusView({
  eoaAddress,
  smartAddress,
  privyToken,
  backendUrl,
  delegatedAddress,
  delegationState,
  removeKey,
}: {
  eoaAddress: string;
  smartAddress: string;
  privyToken: string;
  backendUrl: string;
  delegatedAddress: string | null;
  delegationState: DelegationState;
  removeKey: () => Promise<void>;
}) {
  const [tab, setTab] = React.useState<Tab>('home');

  return (
    <AppDataProvider backendUrl={backendUrl} privyToken={privyToken}>
      <div className="w-full min-h-dvh bg-[#0f0f1a] overflow-y-auto">
        {tab === 'home' && <HomeTab delegationState={delegationState} />}
        {tab === 'activity' && <ActivityTab />}
        {tab === 'points' && <PointsTab />}
        {tab === 'configs' && (
          <ConfigsTab
            eoaAddress={eoaAddress}
            smartAddress={smartAddress}
            delegatedAddress={delegatedAddress}
            removeKey={removeKey}
          />
        )}
        {tab === 'debug' && <DebugTab />}

        <TabDock active={tab} onChange={setTab} />
      </div>
    </AppDataProvider>
  );
}

const TABS: { id: Tab; label: string; Icon: React.FC<{ active: boolean }> }[] = [
  { id: 'home',     label: 'Home',     Icon: HomeIcon },
  { id: 'activity', label: 'Activity', Icon: ActivityIcon },
  { id: 'points',   label: 'Points',   Icon: PointsIcon },
  { id: 'configs',  label: 'Config',   Icon: ConfigIcon },
  { id: 'debug',    label: 'Debug',    Icon: DebugIcon },
];

function TabDock({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <div className="fixed bottom-0 left-0 right-0 flex justify-center pb-[max(env(safe-area-inset-bottom),1rem)] px-3 pointer-events-none z-40">
      <nav
        role="tablist"
        className="flex items-center gap-0.5 w-full max-w-md bg-[#1a1a2e]/90 backdrop-blur-2xl border border-white/[0.08] rounded-2xl p-1 shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.03)] pointer-events-auto"
      >
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={active === id}
            onClick={() => onChange(id)}
            className={`flex-1 min-w-0 flex flex-col items-center gap-1 px-1 py-2 rounded-xl transition-all duration-200 ${
              active === id
                ? 'bg-violet-500/20 text-violet-400'
                : 'text-white/25 hover:text-white/60 hover:bg-white/[0.04]'
            }`}
          >
            <Icon active={active === id} />
            <span className="text-[9px] font-bold tracking-widest uppercase">{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function TabSvg({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <svg
      width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2.5 : 1.8} strokeLinecap="round" strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function HomeIcon({ active }: { active: boolean }) {
  return (
    <TabSvg active={active}>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </TabSvg>
  );
}

function ConfigIcon({ active }: { active: boolean }) {
  return (
    <TabSvg active={active}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06-.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </TabSvg>
  );
}

function DebugIcon({ active }: { active: boolean }) {
  return (
    <TabSvg active={active}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </TabSvg>
  );
}

function PointsIcon({ active }: { active: boolean }) {
  return (
    <TabSvg active={active}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </TabSvg>
  );
}

function ActivityIcon({ active }: { active: boolean }) {
  return (
    <TabSvg active={active}>
      <polyline points="3 12 7 12 10 4 14 20 17 12 21 12" />
    </TabSvg>
  );
}
