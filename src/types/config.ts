export type HarnessType = "pi" | "hermes" | "openclaw" | "opencode" | "custom";

export interface NexusConfig {
  issuer: string;
  walletDir: string;
  defaultWallet?: string;
  autoUpdate?: boolean | "notify";
  passwordMinLength: number;
  tokenCacheDir: string;
  requestTimeout: number;
  harness?: HarnessType;
  harnessCommand?: string;
  harnessArgs?: string[];
  harnessTimeoutSecs?: number;
  spacetime: {
    host: string;
    module: string;
  };
  defaultGenesisUrl?: string;
  genesisSource?: string;
  genesisUrl?: string;
  genesisHash?: string;
  genesisId?: string;
  genesisVersion?: string;
  githubOrg?: string;
  orgName?: string;
  skillsSource?: string;
  skillsRef?: string;
  minProbeVersion?: string;
  promptMarkerTemplate?: string;
}

export const DEFAULT_CONFIG: NexusConfig = {
  issuer: "https://api.zenon.red",
  walletDir: "~/.probe/wallets",
  autoUpdate: "notify",
  passwordMinLength: 8,
  tokenCacheDir: "~/.probe/tokens",
  requestTimeout: 30000,
  harnessTimeoutSecs: 7200,
  harnessArgs: [],
  spacetime: {
    host: "wss://db.zenon.red",
    module: "nexus",
  },
  defaultGenesisUrl:
    "https://raw.githubusercontent.com/zenon-red/nexus/main/orgs/zenon-red/genesis.json",
};

export interface WalletInfo {
  name: string;
  address: string;
  publicKey?: string;
  createdAt?: string;
}

export interface WalletCreationResult {
  name: string;
  address: string;
  publicKey: string;
  mnemonic: string;
}

export interface ChallengeResponse {
  nonce: string;
  challenge: string;
  expiresAt: string;
}

export interface TokenResponse {
  accessToken: string;
  idToken: string;
  expiresIn: number;
}

export interface OutputResult<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; suggestion?: string };
}
