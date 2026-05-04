import { createKernelAccount, createKernelAccountClient } from '@zerodev/sdk';
import { signerToEcdsaValidator } from '@zerodev/ecdsa-validator';
import { createPublicClient, createWalletClient, custom, http } from 'viem';
import { entryPoint07Address } from 'viem/account-abstraction';
import { toOwner } from 'permissionless/utils';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import type { EIP1193Provider } from 'viem';
import type { KernelAccountClient } from '@zerodev/sdk';
import { AA_CONFIG, getAaEntryPoint } from './aaConfig';
import {
  getChainById,
  getRpcUrlById,
  getBundlerUrl,
  getPaymasterUrl,
  getSponsorshipPolicyId,
} from './chainConfig';
import { createLogger } from './logger';

const log = createLogger('createSudoClient');

export async function createSudoClient(
  provider: EIP1193Provider,
  signerAddress: `0x${string}`,
  chainId: number,
): Promise<KernelAccountClient> {
  const chain = getChainById(chainId);
  const rpcUrl = getRpcUrlById(chainId);
  const bundlerRpc = getBundlerUrl(chainId);
  const paymasterUrl = getPaymasterUrl(chainId);
  const sponsorshipPolicyId = getSponsorshipPolicyId(chainId);

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const entryPoint = getAaEntryPoint();

  const walletClient = createWalletClient({
    account: signerAddress,
    chain,
    transport: custom(provider as Parameters<typeof custom>[0]),
  });
  const ownerSigner = await toOwner({ owner: walletClient });

  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    entryPoint,
    signer: ownerSigner,
    kernelVersion: AA_CONFIG.kernelVersion,
  });

  const account = await createKernelAccount(publicClient, {
    entryPoint,
    plugins: { sudo: ecdsaValidator },
    kernelVersion: AA_CONFIG.kernelVersion,
    index: AA_CONFIG.index,
  });

  const pimlicoClient = paymasterUrl
    ? createPimlicoClient({
        transport: http(paymasterUrl),
        entryPoint: { address: entryPoint07Address, version: '0.7' },
      })
    : null;
  const policyExt = sponsorshipPolicyId ? { sponsorshipPolicyId } : {};

  log.debug('creating sudo Kernel client', {
    signerAddress,
    sca: account.address,
    chainId,
    hasPaymaster: !!paymasterUrl,
  });

  return createKernelAccountClient({
    account,
    chain,
    bundlerTransport: http(bundlerRpc),
    ...(pimlicoClient && {
      paymaster: {
        getPaymasterData: (userOp) =>
          pimlicoClient.getPaymasterData({ ...userOp, ...policyExt }),
        getPaymasterStubData: (userOp) =>
          pimlicoClient.getPaymasterStubData({ ...userOp, ...policyExt }),
      },
      userOperation: {
        estimateFeesPerGas: async () =>
          (await pimlicoClient.getUserOperationGasPrice()).fast,
      },
    }),
  });
}
