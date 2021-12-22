
//class should manage all the (base)Agents across chains
//including funding

import { SdkBaseChainConfigParams } from "@connext/nxtp-sdk";
import { ChainConfig } from "./utils/config";
import { Logger } from "ethers/lib/utils";
import { BaseAgent } from "./baseAgent";
import { Config } from "./utils/config";
import { FunderAgent } from "./funderAgent";



export class AgentSdkManager {

  private readonly agents: BaseAgent[];
  private readonly log: Logger;
  private readonly funderAgent: FunderAgent;

  //without the last path digit.
  private readonly mnemonicPath:string = "m/44'/60'/0'/0/";
  private readonly chainConfigurations:Map<number, ChainConfig> = new Map<number,ChainConfig>();
  
  //account address, chainId, connectedSigner

  constructor(config:Config, funderMnemonic:string, AgentMnemonic:string, chainsToManage:number[], enforceFunding?:boolean, mnemonicPath?:string){
  
    for(const chainId of chainsToManage){
      let chainConfig = config.chainConfig[chainId];
      if(chainConfig){
        this.chainConfigurations.set(chainId, chainConfig);
      }
    }
    const funderAgent = new BaseAgent({chainConfig:this.chainConfigurations.get(1)});

    if(enforceFunding){

    }

  }

  createAgent(){
    this.
  }

  getAgentConfig(){

  }
  createAgents(numberOfAgents:number){
    for(let i = 0; i < numberOfAgents; i++){
      this.createAgent(i);
    }
    
  }
  //different path in config? 
  getAgentsFromNextPath(agentsToCreate:number, differentPath?:string){
    //given a mnemonic derrive <number> 
  }






}