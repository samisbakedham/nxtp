import { Logger } from "@connext/nxtp-utils";
import { BigNumber, constants, providers, utils, Wallet } from "ethers";
import PriorityQueue from "p-queue";

import { addLiquidity, getDecimals, getOnchainBalance, sendGift } from "./chain";
import { ChainConfig } from "./config";

// const MINIMUM_FUNDING_MULTIPLE = 2;
// const USER_MIN_ETH = utils.parseEther("0.2");
// const USER_MIN_TOKEN = utils.parseEther("1000000");

export class OnchainAccountManager {
  public readonly wallets: Wallet[] = [];
  walletsWSufficientBalance: number[] = [];

  private cachedDecimals: Record<string, number> = {};

  public readonly funder: Wallet;

  private readonly funderQueues: Map<number, PriorityQueue> = new Map();

  private readonly funderNonces: Map<number, number> = new Map();

  constructor(
    public readonly chainProviders: ChainConfig,
    mnemonic: string,
    public readonly num_users: number,
    private readonly log: Logger,
    public readonly MINIMUM_ETH_FUNDING_MULTIPLE = 1,
    public readonly MINIMUM_TOKEN_FUNDING_MULTIPLE = 5,
    private readonly USER_MIN_ETH = utils.parseEther("0.001"),
    private readonly USER_MIN_TOKEN = "0.1",
  ) {
    this.funder = Wallet.fromMnemonic(mnemonic);
    for (let i = 0; i < num_users; i++) {
      const newWallet = Wallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${i + 1}`);
      if (newWallet) {
        this.wallets.push(newWallet);
      }
    }

    // Create chain-by-chain funder queues
    Object.keys(chainProviders).map((chain) => {
      this.funderQueues.set(parseInt(chain), new PriorityQueue({ concurrency: 1 }));
    });
  }

  async updateBalances(chainId: number, assetId: string = constants.AddressZero): Promise<BigNumber[]> {
    const wallets = this.getCanonicalWallets(this.num_users);
    const resultBalances: BigNumber[] = [];

    await Promise.all(
      wallets.map(async (wallet) => {
        const res = await this.verifyAndReupAccountBalance(wallet.address, chainId, assetId);
        return resultBalances.push(res);
      }),
    );
    
    await this.addLiquidity(chainId, assetId);
    return resultBalances;
  }

  async addLiquidity(chainId: number, assetId: string) {
    const isToken = assetId !== constants.AddressZero;
    if (!isToken) {
      return;
    }

    const { provider } = this.chainProviders[chainId];
    if (!provider) {
      throw new Error(`Provider not configured for ${chainId}`);
    }
    const funderQueue = this.funderQueues.get(chainId);
    if (!funderQueue) {
      throw new Error(`No queue found for ${chainId}`);
    }

    const funder = this.funder.connect(provider);

    const decimals = this.cachedDecimals[assetId] ? this.cachedDecimals[assetId] : await getDecimals(assetId, funder);
    this.cachedDecimals[assetId] = decimals;
    // TODO: Is this number right? Will this give us enough liquidity to work with?
    const amount = utils.parseUnits(this.USER_MIN_TOKEN, decimals).mul(this.num_users).mul(11).div(10).toString();
    await funderQueue.add(async () => {
      this.log.info("Adding liquidity", undefined, undefined, { assetId, chainId, amount });
      let response: providers.TransactionResponse | undefined = undefined;
      const errors: Error[] = [];
      for (let i = 0; i < 3; i++) {
        try {
          response = await addLiquidity(chainId.toString(), assetId, funder, amount, this.funderNonces.get(chainId));
          if (response) {
            break;
          }
        } catch (e) {
          errors.push(e);
        }
      }
      if (!response) {
        throw new Error(`Failed to add liquidity after ${errors.length} attempts: ${errors[0]}`);
      }

      this.funderNonces.set(chainId, response.nonce + 1);
    });
  }

  async verifyAndReupAccountBalance(account: string, chainId: number, assetId: string): Promise<BigNumber> {
    const { provider } = this.chainProviders[chainId];
    if (!provider) {
      throw new Error(`Provider not configured for ${chainId}`);
    }

    const funder = this.funder.connect(provider);

    const funderQueue = this.funderQueues.get(chainId);
    if (!funderQueue) {
      throw new Error(`No queue found for ${chainId}`);
    }

    const decimals = this.cachedDecimals[assetId] ? this.cachedDecimals[assetId] : await getDecimals(assetId, funder);
    this.cachedDecimals[assetId] = decimals;

    const isToken = assetId !== constants.AddressZero;
    const floor = isToken ? utils.parseUnits(this.USER_MIN_TOKEN, decimals) : this.USER_MIN_ETH;
    const initial = await getOnchainBalance(assetId, account, provider);
    if (initial.gte(floor)) {
      this.log.info("No need for top up", undefined, undefined, { assetId, account, chainId });
      return initial;
    }

    const toSend = isToken
      ? floor.mul(this.MINIMUM_TOKEN_FUNDING_MULTIPLE)
      : floor.sub(initial).mul(this.MINIMUM_ETH_FUNDING_MULTIPLE);

    const funderBalance = await getOnchainBalance(assetId, funder.address, provider);
    this.log.info("Balance", undefined, undefined, {
      assetId,
      account,
      chainId,
      toSend: toSend.toString(),
      funderBalance: funderBalance.toString(),
    });

    // Check balance before sending
    if (!isToken) {
      if (funderBalance.lt(toSend)) {
        throw new Error(
          `${funder.address} has insufficient funds of ${assetId} to top up. Has ${funderBalance}, needs ${toSend}`,
        );
      }
    }

    // send gift
    const response = await funderQueue.add(async () => {
      this.log.debug("Sending gift", undefined, undefined, {
        assetId,
        to: account,
        from: funder.address,
        value: toSend.toString(),
      });
      let response: providers.TransactionResponse | undefined = undefined;
      const errors: Error[] = [];
      for (let i = 0; i < 3; i++) {
        try {
          response = await sendGift(assetId, toSend.toString(), account, funder, this.funderNonces.get(chainId));
          break;
        } catch (e) {
          errors.push(e);
        }
      }
      if (!response) {
        throw new Error(`Failed to send gift to ${account} after ${errors.length} attempts: ${errors[0].message}`);
      }

      this.funderNonces.set(chainId, response.nonce + 1);
      return response;
    });

    this.log.info("Submitted top up", undefined, undefined, { assetId, account, txHash: response.hash });
    const receipt = await response.wait();
    this.log.info("Topped up account", undefined, undefined, { assetId, account, txHash: receipt.transactionHash });
    // confirm balance
    const final = await provider.getBalance(account);

    return final;
  }

  getCanonicalWallets(num: number): Wallet[] {
    const wallets: Wallet[] = [];
    for (let i = 0; i < num; i++) {
      if (this.wallets[i]) {
        wallets.push(this.wallets[i]);
      }
    }
    return wallets;
  }

  getRandomWallet(excluding: Wallet[] = []) {
    const addrs = excluding.map((e) => e.address);
    const filtered = this.wallets.filter((n) => {
      return !addrs.includes(n.address);
    });
    if (filtered.length === 0) {
      throw new Error("Failed to get random wallet");
    }
    return filtered[Math.floor(Math.random() * filtered.length)];
  }
}
