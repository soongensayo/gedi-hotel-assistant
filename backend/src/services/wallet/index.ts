import type { PassData, GeneratedPass, WalletProvider } from './types';
import { appleWalletProvider } from './appleWallet';
import { config } from '../../config';

export type { PassData, GeneratedPass } from './types';

export type WalletPlatform = 'apple' | 'google';

const providers: Partial<Record<WalletPlatform, WalletProvider>> = {
  apple: appleWalletProvider,
};

export async function generateWalletPass(
  platform: WalletPlatform,
  data: PassData,
): Promise<GeneratedPass> {
  const provider = providers[platform];

  if (!provider) {
    throw new Error(
      `Wallet provider "${platform}" is not implemented yet. Available: ${Object.keys(providers).join(', ')}`,
    );
  }

  return provider.generatePass(data);
}

export function isWalletConfigured(platform: WalletPlatform): boolean {
  if (platform === 'apple') {
    return !!(config.applePassTypeId && config.appleTeamId && config.applePassP12Path && config.appleWwdrCertPath);
  }
  return false;
}
