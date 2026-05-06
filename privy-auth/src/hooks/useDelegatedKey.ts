import React from 'react';
import type { ConnectedWallet } from '@privy-io/react-auth';
import type { Hex } from 'viem';
import {
  generateKeypair,
  encryptBlob,
  decryptBlob,
  installSessionKey,
  type Permission,
  type DelegationRecord,
} from '../utils/crypto';
import {
  cloudStorageGetItem,
  cloudStorageSetItem,
  cloudStorageRemoveItem,
} from '../utils/telegramStorage';
import { toErrorMessage } from '../utils/toErrorMessage';
import { createLogger } from '../utils/logger';
import { getChainId } from '../utils/chainConfig';

const log = createLogger('useDelegatedKey');
const STORAGE_KEY = 'delegated_key';

// Placeholder — real per-token limits are enforced server-side via /delegation/grant.
const DEFAULT_PERMISSIONS: Permission[] = [
  {
    tokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    maxAmount: '1000000000000000000',
    validUntil: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
  },
];

export type DelegationState =
  | { status: 'idle' }
  | { status: 'processing'; step: string; chainId?: number }
  | { status: 'done'; record: DelegationRecord; installedChainIds: number[] }
  | { status: 'error'; message: string; chainId?: number };

type Action =
  | { type: 'PROCESSING'; step: string; chainId?: number }
  | { type: 'DONE'; record: DelegationRecord; installedChainIds: number[] }
  | { type: 'ERROR'; message: string; chainId?: number }
  | { type: 'IDLE' };

function reducer(_: DelegationState, action: Action): DelegationState {
  switch (action.type) {
    case 'PROCESSING': return { status: 'processing', step: action.step, chainId: action.chainId };
    case 'DONE':       return { status: 'done', record: action.record, installedChainIds: action.installedChainIds };
    case 'ERROR':      return { status: 'error', message: action.message, chainId: action.chainId };
    case 'IDLE':       return { status: 'idle' };
  }
}

type StoredKeypair = { privateKey: Hex; address: Hex };

function isUserRejection(err: unknown): boolean {
  if ((err as { code?: number })?.code === 4001) return true;
  return err instanceof Error && err.message.includes('User rejected');
}

interface UseDelegatedKeyResult {
  state: DelegationState;
  start: () => void;
  unlock: () => void;
  removeKey: () => Promise<void>;
  /** Home-chain serialized permission account blob (back-compat for single-chain callers). */
  serializedBlob: string | null;
  /** Per-chain serialized permission account blobs. */
  serializedBlobs: Record<number, string>;
  /** Chain IDs the current keypair is verified-installed on. */
  installedChainIds: number[];
  /** Trigger an install on a chain that isn't in installedChainIds yet. */
  installOnChain: (chainId: number) => void;
}

export function useDelegatedKey(options: {
  smartAccountAddress: string;
  signerAddress: string;
  signerWallet: ConnectedWallet | undefined;
  privyDid: string; // deterministic derivation input — no user prompt
  /** Chain IDs to install on. Defaults to [getChainId()]. Passing two installs sequentially. */
  chainIds?: number[];
}): UseDelegatedKeyResult {
  const { smartAccountAddress, signerAddress, signerWallet, privyDid } = options;
  const chainIdsToInstall = React.useMemo(
    () => options.chainIds ?? [getChainId()],
    // The default is a fresh array each render — memoize on the JSON form so
    // identity is stable when the caller passes the same set repeatedly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(options.chainIds ?? [getChainId()])],
  );
  const [state, dispatch] = React.useReducer(reducer, { status: 'idle' });

  const [serializedBlobs, setSerializedBlobs] = React.useState<Record<number, string>>({});
  const [installedChainIds, setInstalledChainIds] = React.useState<number[]>([]);
  const keypairRef = React.useRef<StoredKeypair | null>(null);

  const homeChainId = getChainId();
  const serializedBlob = serializedBlobs[homeChainId] ?? null;

  const persistAll = React.useCallback(async (blobs: Record<number, string>, installed: number[]) => {
    if (!keypairRef.current) return;
    const payload = JSON.stringify({
      privateKey: keypairRef.current.privateKey,
      address: keypairRef.current.address,
      blobs,
      installedChainIds: installed,
    });
    await cloudStorageSetItem(STORAGE_KEY, await encryptBlob(payload, privyDid));
  }, [privyDid]);

  // Returns the parsed { blobs, installed } so callers can act on the values
  // synchronously rather than racing the React state setters.
  const applyDecryptedBlob = React.useCallback(
    (decrypted: string): { blobs: Record<number, string>; installed: number[] } => {
      try {
        const wrapper = JSON.parse(decrypted);
        if (wrapper.privateKey) {
          keypairRef.current = {
            privateKey: wrapper.privateKey as Hex,
            address: (wrapper.address ?? '0x') as Hex,
          };
          // New format: blobs map per chain. Old format: single `blob`.
          if (wrapper.blobs && typeof wrapper.blobs === 'object') {
            const blobs: Record<number, string> = {};
            for (const [k, v] of Object.entries(wrapper.blobs)) {
              const cid = Number(k);
              if (Number.isFinite(cid) && typeof v === 'string') blobs[cid] = v;
            }
            const installed: number[] = Array.isArray(wrapper.installedChainIds)
              ? wrapper.installedChainIds.filter((n: unknown) => typeof n === 'number')
              : Object.keys(blobs).map(Number);
            setSerializedBlobs(blobs);
            setInstalledChainIds(installed);
            return { blobs, installed };
          }
          if (typeof wrapper.blob === 'string') {
            // Legacy: single home-chain blob, no installedChainIds metadata.
            const blobs = { [homeChainId]: wrapper.blob };
            setSerializedBlobs(blobs);
            setInstalledChainIds([homeChainId]);
            return { blobs, installed: [homeChainId] };
          }
        }
      } catch {
        // Legacy raw blob without keypair metadata — assume home chain.
        const blobs = { [homeChainId]: decrypted };
        setSerializedBlobs(blobs);
        setInstalledChainIds([homeChainId]);
        return { blobs, installed: [homeChainId] };
      }
      return { blobs: {}, installed: [] };
    },
    [homeChainId],
  );

  const buildRecord = React.useCallback((): DelegationRecord => ({
    publicKey: keypairRef.current?.address ?? '',
    address: (keypairRef.current?.address ?? '0x') as `0x${string}`,
    smartAccountAddress: smartAccountAddress as `0x${string}`,
    signerAddress: signerAddress as `0x${string}`,
    permissions: DEFAULT_PERMISSIONS,
    grantedAt: Math.floor(Date.now() / 1000),
  }), [smartAccountAddress, signerAddress]);

  // Tries to decrypt an existing stored blob. Returns the parsed install list
  // on success, null on failure. Avoid relying on `installedChainIds` state in
  // the same callback — the setter is async.
  const tryRestore = React.useCallback(
    async (existing: string): Promise<{ installed: number[] } | null> => {
      dispatch({ type: 'PROCESSING', step: 'Decrypting session key…' });
      try {
        const decrypted = await decryptBlob(existing, privyDid);
        const { installed } = applyDecryptedBlob(decrypted);
        return { installed };
      } catch {
        return null;
      }
    },
    [privyDid, applyDecryptedBlob],
  );

  // Install on a single chain. Returns the serialized blob.
  const installOne = React.useCallback(async (chainId: number): Promise<string> => {
    if (!signerWallet) throw new Error('Privy embedded wallet not found');
    if (!keypairRef.current) throw new Error('keypair not initialised');
    const rawProvider = await signerWallet.getEthereumProvider();
    log.info('step', { step: 'started', chainId });
    try {
      const blob = await installSessionKey(
        rawProvider as Parameters<typeof installSessionKey>[0],
        signerAddress as `0x${string}`,
        keypairRef.current.privateKey,
        keypairRef.current.address,
        chainId,
      );
      log.info('step', { step: 'succeeded', chainId, address: keypairRef.current.address });
      return blob;
    } catch (err) {
      log.error('session-key-install-failed', { chainId, err: toErrorMessage(err) });
      throw err;
    }
  }, [signerWallet, signerAddress]);

  const createAndStore = React.useCallback(async (chainIds: number[]) => {
    dispatch({ type: 'PROCESSING', step: 'Generating session keypair…' });
    const keypair = generateKeypair();
    keypairRef.current = { privateKey: keypair.privateKey, address: keypair.address };
    log.debug('keypair-derived', { address: keypair.address });

    const blobs: Record<number, string> = {};
    const installed: number[] = [];
    for (let i = 0; i < chainIds.length; i++) {
      const cid = chainIds[i]!;
      dispatch({
        type: 'PROCESSING',
        step: `Installing session key on chain ${cid} (${i + 1}/${chainIds.length})…`,
        chainId: cid,
      });
      const blob = await installOne(cid);
      blobs[cid] = blob;
      installed.push(cid);
    }
    setSerializedBlobs(blobs);
    setInstalledChainIds(installed);

    dispatch({ type: 'PROCESSING', step: 'Storing session key…' });
    await persistAll(blobs, installed);

    dispatch({ type: 'DONE', record: buildRecord(), installedChainIds: installed });
  }, [installOne, persistAll, buildRecord]);

  // Restore-only: decrypts and surfaces an existing stored key. Never creates.
  const unlock = React.useCallback(() => {
    if (!smartAccountAddress || !privyDid) return;
    (async () => {
      try {
        dispatch({ type: 'PROCESSING', step: 'Checking stored session key…' });
        const existing = await cloudStorageGetItem(STORAGE_KEY);
        if (!existing) return dispatch({ type: 'IDLE' });

        const restored = await tryRestore(existing);
        if (restored) {
          dispatch({ type: 'DONE', record: buildRecord(), installedChainIds: restored.installed });
          return;
        }
        log.warn('auto-unlock: decryption failed — clearing stale key');
        await cloudStorageRemoveItem(STORAGE_KEY).catch(() => {});
        dispatch({ type: 'IDLE' });
      } catch (err) {
        dispatch({ type: 'IDLE' });
        log.warn('auto-unlock failed', { err: toErrorMessage(err) });
      }
    })();
  }, [smartAccountAddress, privyDid, tryRestore, buildRecord]);

  // Restore-or-create. Falls through to create() if stored blob can't be decrypted
  // (typical cause: user re-created the Privy account).
  //
  // Important: on successful restore we do NOT silently top-up missing chains.
  // Existing-user BSC enablement is handled lazily by BscDelegationModal when a
  // BSC SignRequest arrives — that's the contract documented in FE plan P2.3
  // and BE plan §"Cross-chain delegation". Auto-prompting on app load would
  // surprise the user with a Privy popup outside any explicit cross-chain flow.
  const start = React.useCallback(() => {
    if (!smartAccountAddress || !privyDid) return;
    (async () => {
      try {
        dispatch({ type: 'PROCESSING', step: 'Checking stored session key…' });
        const existing = await cloudStorageGetItem(STORAGE_KEY);

        if (existing) {
          const restored = await tryRestore(existing);
          if (restored) {
            log.debug('choice', { choice: 'cache-hit' });
            dispatch({ type: 'DONE', record: buildRecord(), installedChainIds: restored.installed });
            return;
          }
          log.warn('decryption failed — regenerating keypair');
          log.debug('choice', { choice: 'regenerate' });
        } else {
          log.debug('choice', { choice: 'install' });
        }

        await createAndStore(chainIdsToInstall);
      } catch (err) {
        if (isUserRejection(err)) {
          dispatch({ type: 'ERROR', message: 'You rejected the signing request — please try again.' });
          return;
        }
        log.error('start-failed', { err: toErrorMessage(err) });
        dispatch({ type: 'ERROR', message: toErrorMessage(err) });
      }
    })();
  }, [smartAccountAddress, privyDid, tryRestore, buildRecord, createAndStore, chainIdsToInstall]);

  // Add a chain to an already-installed keypair.
  const installOnChain = React.useCallback((chainId: number) => {
    if (!keypairRef.current) {
      log.warn('installOnChain called before keypair is loaded', { chainId });
      return;
    }
    if (installedChainIds.includes(chainId)) {
      log.debug('installOnChain: already installed', { chainId });
      dispatch({ type: 'DONE', record: buildRecord(), installedChainIds });
      return;
    }
    (async () => {
      try {
        dispatch({ type: 'PROCESSING', step: `Approving on chain ${chainId}…`, chainId });
        const blob = await installOne(chainId);
        const nextBlobs = { ...serializedBlobs, [chainId]: blob };
        const nextInstalled = [...installedChainIds, chainId];
        setSerializedBlobs(nextBlobs);
        setInstalledChainIds(nextInstalled);
        await persistAll(nextBlobs, nextInstalled);
        dispatch({ type: 'DONE', record: buildRecord(), installedChainIds: nextInstalled });
      } catch (err) {
        if (isUserRejection(err)) {
          dispatch({ type: 'ERROR', message: 'You rejected the signing request — please try again.', chainId });
          return;
        }
        log.error('installOnChain-failed', { chainId, err: toErrorMessage(err) });
        dispatch({ type: 'ERROR', message: toErrorMessage(err), chainId });
      }
    })();
  }, [installedChainIds, serializedBlobs, installOne, persistAll, buildRecord]);

  const removeKey = React.useCallback(async () => {
    await cloudStorageRemoveItem(STORAGE_KEY);
    setSerializedBlobs({});
    setInstalledChainIds([]);
    keypairRef.current = null;
    dispatch({ type: 'ERROR', message: 'Key removed — reload to create a new one.' });
  }, []);

  return {
    state,
    start,
    unlock,
    removeKey,
    serializedBlob,
    serializedBlobs,
    installedChainIds,
    installOnChain,
  };
}

export type { DelegationRecord } from '../utils/crypto';
