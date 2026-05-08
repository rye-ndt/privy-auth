import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, createPublicClient, custom, http } from 'viem';
import { toOwner } from 'permissionless/utils';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { entryPoint07Address } from 'viem/account-abstraction';
import { signerToEcdsaValidator } from '@zerodev/ecdsa-validator';
import { createKernelAccount, createKernelAccountClient, addressToEmptyAccount, uninstallPlugin } from '@zerodev/sdk';
import { getEntryPoint, KERNEL_V3_1 } from '@zerodev/sdk/constants';
import { toECDSASigner } from '@zerodev/permissions/signers';
import { toPermissionValidator, serializePermissionAccount, deserializePermissionAccount } from '@zerodev/permissions';
import { toSudoPolicy } from '@zerodev/permissions/policies';
import type { EIP1193Provider } from 'viem';
import type { KernelAccountClient } from '@zerodev/sdk';
import { createLogger } from './logger';
import { instrumentTransport } from './rpcTrace';
import {
  getChainById,
  getChainId,
  getRpcUrlById,
  getBundlerUrl,
  getPaymasterUrl,
  getSponsorshipPolicyId,
} from './chainConfig';

const log = createLogger('crypto');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Permission = {
  tokenAddress: `0x${string}`;
  maxAmount: string;
  validUntil: number;
};

export type DelegationRecord = {
  publicKey: string;
  address: `0x${string}`;
  smartAccountAddress: `0x${string}`;
  signerAddress: `0x${string}`;
  permissions: Permission[];
  grantedAt: number;
};

type Keypair = {
  privateKey: `0x${string}`;
  publicKey: string;
  address: `0x${string}`;
};

// ---------------------------------------------------------------------------
// Keypair generation
// ---------------------------------------------------------------------------

export function generateKeypair(): Keypair {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return { privateKey, publicKey: account.publicKey, address: account.address };
}

// ---------------------------------------------------------------------------
// AES-GCM encryption / decryption
// Blob layout: [16 bytes salt][12 bytes iv][ciphertext], base64-encoded
// ---------------------------------------------------------------------------

export async function encryptBlob(data: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(data),
  );
  const result = new Uint8Array(16 + 12 + ciphertext.byteLength);
  result.set(salt, 0);
  result.set(iv, 16);
  result.set(new Uint8Array(ciphertext), 28);
  return btoa(String.fromCharCode(...result));
}

export async function decryptBlob(encrypted: string, password: string): Promise<string> {
  const bytes = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const salt = bytes.slice(0, 16);
  const iv = bytes.slice(16, 28);
  const ciphertext = bytes.slice(28);
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error('Decryption failed — wrong password');
  }
}

// ---------------------------------------------------------------------------
// ZeroDev session key installation
// ---------------------------------------------------------------------------

export async function installSessionKey(
  provider: EIP1193Provider,
  signerAddress: `0x${string}`,
  sessionPrivateKey: `0x${string}`,
  sessionKeyAddress: `0x${string}`,
  chainId: number,
): Promise<string> {
  const chain = getChainById(chainId);
  const rpcUrl = getRpcUrlById(chainId);

  // 1. Build a viem WalletClient backed by the Privy embedded wallet provider.
  //    The owner only signs userOp HASHES via personal_sign — chain-agnostic —
  //    so we declare the wallet on the home chain (always allow-listed by
  //    Privy) while the kernel/public clients live on the target chain. This
  //    is what unblocks BSC userOps when Privy doesn't list BSC as supported.
  const signerChain = getChainById(getChainId());
  const walletClient = createWalletClient({
    account: signerAddress,
    chain: signerChain,
    transport: custom(provider as Parameters<typeof custom>[0]),
  });

  // 2. Convert to a ZeroDev-compatible SmartAccountSigner
  const privySigner = await toOwner({ owner: walletClient });

  // 3. Public client pointing at the chain JSON-RPC (NOT the bundler RPC).
  //    ZeroDev uses this for eth_call / eth_getCode against the kernel factory and
  //    validator contracts; bundler-only endpoints return non-standard revert
  //    envelopes that crash viem's error decoder ("revertError.cause.data.match").
  const publicClient = createPublicClient({ transport: http(rpcUrl), chain });

  const entryPoint = getEntryPoint('0.7');
  const kernelVersion = KERNEL_V3_1;

  // 4. ECDSA validator — Privy EOA is the Kernel account owner
  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    entryPoint,
    signer: privySigner,
    kernelVersion,
  });

  // 5. Build the permission plugin using only the session key's *address* (no private key needed here)
  const emptySessionAccount = addressToEmptyAccount(sessionKeyAddress);
  const emptySessionKeySigner = await toECDSASigner({ signer: emptySessionAccount });

  // 6. toSudoPolicy grants full access — replace with toCallPolicy in production
  const permissionPlugin = await toPermissionValidator(publicClient, {
    entryPoint,
    signer: emptySessionKeySigner,
    policies: [toSudoPolicy({})],
    kernelVersion,
  });

  // 7. Kernel account with both owner (sudo) and session key (regular) plugins
  const sessionKeyAccount = await createKernelAccount(publicClient, {
    entryPoint,
    plugins: {
      sudo: ecdsaValidator,       // Owner (Privy EOA) — signs this setup UserOp
      regular: permissionPlugin,  // Session key — validates all future autonomous actions
    },
    kernelVersion,
  });

  log.debug('installSessionKey', { chainId, signerAddress, sessionKeyAddress });

  // 8. Serialize with the session private key embedded.
  //    This triggers the Privy popup — the owner signs the UserOp that installs the plugin on-chain.
  //    The returned blob is stored encrypted in CloudStorage; it is never sent to the backend.
  return await serializePermissionAccount(sessionKeyAccount, sessionPrivateKey);
}


// ---------------------------------------------------------------------------
// Signing account reconstruction (for future UserOp submission)
// ---------------------------------------------------------------------------

export async function createSessionKeyClient(
  serializedBlob: string,
  chainId: number,
): Promise<KernelAccountClient> {
  // Fail fast if this build wasn't configured with a bundler URL for the requested chain.
  let bundlerRpc: string;
  try {
    bundlerRpc = getBundlerUrl(chainId);
  } catch {
    throw new Error(`Chain ${chainId} is not configured in this build (missing bundler URL)`);
  }
  const paymasterUrl = getPaymasterUrl(chainId);
  const sponsorshipPolicyId = getSponsorshipPolicyId(chainId);

  log.debug('createSessionKeyClient', {
    chainId,
    hasPaymaster: !!paymasterUrl,
    hasPolicy: !!sponsorshipPolicyId,
  });
  try {
    const chain = getChainById(chainId);
    const rpcUrl = getRpcUrlById(chainId);
    const publicClient = createPublicClient({
      transport: http(rpcUrl, instrumentTransport(rpcUrl, chainId, 'rpc')),
      chain,
    });
    const entryPoint = getEntryPoint('0.7');

    // Reconstructs the full KernelSmartAccount from the serialized blob.
    // The blob contains the session private key and all on-chain permission proof data.
    const account = await deserializePermissionAccount(
      publicClient,
      entryPoint,
      KERNEL_V3_1,
      serializedBlob,
    );

    const pimlicoClient = paymasterUrl
      ? createPimlicoClient({
          transport: http(paymasterUrl, instrumentTransport(paymasterUrl, chainId, 'paymaster')),
          entryPoint: { address: entryPoint07Address, version: '0.7' },
        })
      : null;

    // Pimlico applies the sponsorship policy only when sponsorshipPolicyId is
    // attached to the paymaster RPC params. Without it the paymaster falls back
    // to its account-default policy (which may reject everything).
    const policyExt = sponsorshipPolicyId ? { sponsorshipPolicyId } : {};

    return createKernelAccountClient({
      account,
      chain,
      bundlerTransport: http(bundlerRpc, instrumentTransport(bundlerRpc, chainId, 'bundler')),
      ...(pimlicoClient && {
        paymaster: {
          getPaymasterData: (userOp) =>
            pimlicoClient.getPaymasterData({ ...userOp, ...policyExt }),
          getPaymasterStubData: (userOp) =>
            pimlicoClient.getPaymasterStubData({ ...userOp, ...policyExt }),
        },
        userOperation: {
          estimateFeesPerGas: async () => (await pimlicoClient.getUserOperationGasPrice()).fast,
        },
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    log.error('createSessionKeyClient failed', { chainId, err: msg });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// ZeroDev session key revocation
//
// Onchain invalidation of every spending cap held by a session key. We rebuild
// the same `regular` permission validator the install path used (same session
// key address, same sudo policy shape) and call `uninstallPlugin` with the
// kernel running under the *sudo* (Privy EOA) validator. The userOp triggers a
// Privy popup; once mined the kernel deletes the regular validator from
// storage so any cap-policy state attached to it is unreachable.
// ---------------------------------------------------------------------------
export async function uninstallSessionKey(
  provider: EIP1193Provider,
  signerAddress: `0x${string}`,
  sessionKeyAddress: `0x${string}`,
  chainId: number,
): Promise<`0x${string}`> {
  const chain = getChainById(chainId);
  const rpcUrl = getRpcUrlById(chainId);
  const signerChain = getChainById(getChainId());

  const walletClient = createWalletClient({
    account: signerAddress,
    chain: signerChain,
    transport: custom(provider as Parameters<typeof custom>[0]),
  });
  const privySigner = await toOwner({ owner: walletClient });
  const publicClient = createPublicClient({ transport: http(rpcUrl), chain });
  const entryPoint = getEntryPoint('0.7');
  const kernelVersion = KERNEL_V3_1;

  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    entryPoint,
    signer: privySigner,
    kernelVersion,
  });

  // Recreate the regular validator the same way installSessionKey did so its
  // address (the value the kernel stores) matches the installed plugin. We
  // never sign with this — only the validator identity is needed.
  const emptySessionAccount = addressToEmptyAccount(sessionKeyAddress);
  const emptySessionKeySigner = await toECDSASigner({ signer: emptySessionAccount });
  const permissionPlugin = await toPermissionValidator(publicClient, {
    entryPoint,
    signer: emptySessionKeySigner,
    policies: [toSudoPolicy({})],
    kernelVersion,
  });

  // Sudo-only kernel — uninstallPlugin must run under the owner.
  const account = await createKernelAccount(publicClient, {
    entryPoint,
    plugins: { sudo: ecdsaValidator },
    kernelVersion,
  });

  let bundlerRpc: string;
  try {
    bundlerRpc = getBundlerUrl(chainId);
  } catch {
    throw new Error(`Chain ${chainId} is not configured in this build (missing bundler URL)`);
  }
  const paymasterUrl = getPaymasterUrl(chainId);
  const sponsorshipPolicyId = getSponsorshipPolicyId(chainId);
  const pimlicoClient = paymasterUrl
    ? createPimlicoClient({
        transport: http(paymasterUrl, instrumentTransport(paymasterUrl, chainId, 'paymaster')),
        entryPoint: { address: entryPoint07Address, version: '0.7' },
      })
    : null;
  const policyExt = sponsorshipPolicyId ? { sponsorshipPolicyId } : {};

  const kernelClient = createKernelAccountClient({
    account,
    chain,
    bundlerTransport: http(bundlerRpc, instrumentTransport(bundlerRpc, chainId, 'bundler')),
    ...(pimlicoClient && {
      paymaster: {
        getPaymasterData: (userOp) =>
          pimlicoClient.getPaymasterData({ ...userOp, ...policyExt }),
        getPaymasterStubData: (userOp) =>
          pimlicoClient.getPaymasterStubData({ ...userOp, ...policyExt }),
      },
      userOperation: {
        estimateFeesPerGas: async () => (await pimlicoClient.getUserOperationGasPrice()).fast,
      },
    }),
  });

  log.debug('uninstallSessionKey', { chainId, signerAddress, sessionKeyAddress });
  return await uninstallPlugin(kernelClient, { plugin: permissionPlugin });
}
