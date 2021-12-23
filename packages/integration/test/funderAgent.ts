import { getOnchainBalance, jsonifyError } from "@connext/nxtp-utils";
import { constants, providers, Signer, utils, Wallet } from "ethers";
import { Logger } from "pino";
import { stringify } from "querystring";
import { getDecimals } from "./utils/chain";

class AccountManager{

  private cachedDecimals: Record<string, number> = {};
  
  constructor(private readonly signer: Wallet,
              private readonly log:Logger,
              private readonly USER_MIN_TOKEN:string = "5",
              private readonly USER_MIN_ETH:string = "0.2",
              private readonly TOKEN_MULTIPLE:string = "1",
              private readonly ETH_MULTIPLE:string = "1"){
    
  }
  async getAssetDecmials(assetId:string){
    const decimals = this.cachedDecimals[assetId] ? this.cachedDecimals[assetId] : await getDecimals(assetId, this.signer);
    this.cachedDecimals[assetId] = decimals;
    return decimals;
  }

  async updateDecimals(chainId: number, agentAddress:string, assetId: string = constants.AddressZero){
    try {
      const decimals = await this.getAssetDecmials(assetId);
      this.log.debug(`Got asset decimals...`);
      return decimals;
    } catch (e) {
      this.log.error("Failed to get decimals!", undefined, undefined, jsonifyError(e), { chainId, assetId });
    }

  }
  async verifyAndUpdateBalance(funderWallet:Wallet, agentAddress:string, chainId:number, assetId:string){
    
    const providerNetwork = await funderWallet.provider.getNetwork();

    if(providerNetwork.chainId !== chainId){
      this.log.error(`Provider not configured for ${chainId}`);
      throw new Error(`Incorrect Provider`);
    }
    const decimals = await this.updateDecimals(chainId, agentAddress, assetId);
    const isToken = assetId !== constants.AddressZero;
    const floor = isToken ? utils.parseUnits(this.USER_MIN_TOKEN, decimals) : utils.parseEther(this.USER_MIN_ETH);
    const initial = await getOnchainBalance(assetId, agentAddress, funderWallet.provider);
    
    if (initial.gte(floor)) {
      this.log.info("No need for top up", undefined, undefined, { assetId, agentAddress, chainId });
      return initial;
    }

    const toSend = isToken
      ? floor.mul(this.TOKEN_MULTIPLE)
      : floor.sub(initial).mul(this.ETH_MULTIPLE);

  }

}

export class FunderAgent extends AccountManager{


  constructor(private readonly wallet:Wallet, private readonly provider: providers.FallbackProvider, log:Logger){
    super(wallet, log);

  }



}
