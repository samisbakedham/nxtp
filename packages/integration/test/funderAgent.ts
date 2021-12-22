import { getOnchainBalance, jsonifyError } from "@connext/nxtp-utils";
import { constants, providers, Signer, utils, Wallet } from "ethers";
import { Logger } from "pino";
import { getDecimals } from "./utils/chain";

class AccountManager{

  private cachedDecimals: Record<string, number> = {};
  
  constructor(private readonly signer: Wallet,
              private readonly log:Logger,
              private readonly USER_MIN_TOKEN:number,
              private readonly USER_MIN_ETH:number, ){
    
  }
  async updateBalances(chainId: number, agentAddress:string, assetId: string = constants.AddressZero){
    try {
      const decimals = this.cachedDecimals[assetId] ? this.cachedDecimals[assetId] : await getDecimals(assetId, this.signer);
      this.cachedDecimals[assetId] = decimals;
    } catch (e) {
      this.log.error("Failed to get decimals!", undefined, undefined, jsonifyError(e), { chainId, assetId });
    }
    
    const isToken = assetId !== constants.AddressZero;
    const floor = isToken ? utils.parseUnits(this.USER_MIN_TOKEN, decimals) : this.USER_MIN_ETH;

    const initialAmount = await getOnchainBalance(assetId, agentAddress, this.signer.provider );

    if (initialAmount.gte(floor)) {
      this.log.info("No need for top up", undefined, undefined, { assetId, agentAddress, chainId });
      return initial;
    }


  }


}

export class FunderAgent extends AccountManager{


  constructor(private readonly wallet:Wallet, private readonly provider: providers.FallbackProvider, log:Logger){
    super(wallet, log);

  }



}