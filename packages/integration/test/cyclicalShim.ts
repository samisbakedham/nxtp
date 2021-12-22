import { getConfig } from "./utils/config";
import { AgentSdkManager } from "./agentMgmt";
import pino from "pino";

//refactor into config
const LOGGING_LEVEL = "debug"

const cyclicalTest = async (numberOfAgents:number, durationMins: number){
  const config = getConfig();
  const log = pino({level:LOGGING_LEVEL});

  const durationMs = durationMins * 60 * 1000;

  const chainsToSwap = [137, 250];
  const agentManager = new AgentSdkManager(config, config.mnemonic, config.mnemonic, chainsToSwap);
}