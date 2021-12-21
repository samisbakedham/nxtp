import { ethers, providers, Signer } from "ethers";
import { Logger, UserNxtpNatsMessagingService, ChainData, getRandomBytes32, createLoggingContext, AuctionBid, AuctionResponse } from "@connext/nxtp-utils";
import { SdkBaseChainConfigParams, NxtpSdkBase, getMinExpiryBuffer, CrossChainParams} from "@connext/nxtp-sdk";
import { getConfig } from "./utils/config";

//need to sepearate signer and sdk "write" optional transaction parameters as well as per chain logic.  

export class BaseAgent {

  private readonly signerByChainId?: Map<number, Signer>;
  public readonly chainData?: Map<string, ChainData>;
  private readonly sdkBase: NxtpSdkBase;
  private readonly logger: Logger;

  private connectedSigner: Signer;
  public readonly address: string;

  constructor(
    private readonly config: {
      chainConfig: SdkBaseChainConfigParams;
      signer: Signer;
      messagingSigner?: Signer;
      logger?: Logger;
      network?: "testnet" | "mainnet" | "local";
      natsUrl?: string;
      authUrl?: string;
      messaging?: UserNxtpNatsMessagingService;
      skipPolling?: boolean;
      sdkBase?: NxtpSdkBase;
      chainData?: Map<string, ChainData>;
    }
  ){
    const {
      chainConfig,
      signer,
      messagingSigner,
      messaging,
      natsUrl,
      authUrl,
      logger,
      network,
      skipPolling,
      sdkBase,
      chainData,
    } = this.config;

    this.logger = logger ?? new Logger({name: 'NXTP Base SDK'});

    this.sdkBase =
      sdkBase ??
      new NxtpSdkBase({
        chainConfig,
        signerAddress: signer.getAddress(),
        authUrl,
        messaging,
        natsUrl,
        signer,
        logger: this.logger.child({ name: "NxtpSdkBase" }),
        network,
        messagingSigner,
        skipPolling,
        chainData,
      });
      this.chainData = this.sdkBase.chainData;

  }

  async createBid(params: Omit<CrossChainParams, "receivingAddress" | "expiry"> & { receivingAddress?: string }): Promise<any | undefined>{

    const minExpiry = getMinExpiryBuffer();
    const buffer = 5 * 60;
    const bid = {
        receivingAddress: this.address,
        expiry: Math.floor(Date.now() / 1000) + minExpiry + buffer, // Use min + 5m
        transactionId: getRandomBytes32(),
        preferredRouters: getConfig().routers.length > 0 ? getConfig().routers : undefined,
        ...params,

    };
    const {requestContext, methodContext} = createLoggingContext(this.createBid.name, undefined, bid.transactionId,);
    this.logger.debug("Created bid data", requestContext, methodContext, {bid});

    return bid;

  }
  async publishAuction(bid:any):Promise<AuctionResponse | undefined>{
    const {requestContext, methodContext} = createLoggingContext(this.publishAuction.name, undefined, bid.transactionId,);

    let auction:AuctionResponse | undefined;
    let attempts = 0;

    const MAX_ATTEMPTS = 3;

    try{
      while(!auction && attempts < MAX_ATTEMPTS){
        auction = await this.sdkBase.getTransferQuote(bid);
        attempts++;
      }
    }catch (e) {
      this.logger.debug(`Error getting auction: `, requestContext, methodContext, { error: e.message });
    }
    this.logger.debug(
      `Auction attempt ${attempts} for txID: ${bid.transactionId}`,
      requestContext,
      methodContext,
      { auction: auction, txid: bid.transactionId },
    );

    return auction;
  }

  async prepareXfr(auction:AuctionResponse, overrides?: Partial<providers.TransactionRequest>):Promise<providers.TransactionRequest | void>{
    if(auction.bid){
      const {requestContext, methodContext} = createLoggingContext(this.prepareXfr.name, undefined, auction.bid.transactionId,);
      try{
        const prepareXfr = await this.sdkBase.prepareTransfer(auction);
        if(prepareXfr && overrides){
          prepareXfr.gasLimit = overrides.gasLimit;
          prepareXfr.gasPrice = overrides.gasPrice;
        }
        return prepareXfr;
      }catch(e){
        this.logger.debug(`${JSON.stringify(e)}`, requestContext, methodContext);
      }
    }
  }

  validateSignerChainid(txRequest:providers.TransactionRequest){
    const txChainId = txRequest.chainId;
    const connectedChainId = await this.getSignerChainId();
      //switch signer to appropriate chain if needed
      if(txChainId !== connectedChainId){
        //
        if(txChainId)
        this.switchSignerChainId(txChainId);
      }
  }

  getOrCreateSignerByChainId(chainId:number){

  }

  switchSignerChainId(chainId:number){
    //useful for either side of the ping-pong when, ex. crosschain prepares.
    const newSigner = this.signerByChainId?.get(chainId);
    if(newSigner)
      this.connectedSigner = newSigner;
  }

  async getSignerChainId():Promise<number>{
    return await this.connectedSigner.getChainId();
  }

  async initTransfer(params:Omit<CrossChainParams, "receivingAddress" | "expiry"> & { receivingAddress?: string }){
    const bid = await this.createBid(params);
    const auctionRes = await this.publishAuction(bid);

    if(auctionRes){
      const transferData = await this.prepareXfr(auctionRes);
        if(transferData){
          this.validateSignerChainid(transferData);
          await this.connectedSigner.sendTransaction(transferData);
        }
      }
      
    }
    
  }
}