//mapping chainId to most in sync graph
import {createClient} from 'redis';
import axios from 'axios';
import express from 'express';
import {getConfig} from '@connext/nxtp-router';
import { ChainData, getDeployedSubgraphUri, getSubgraphHealth } from "@connext/nxtp-utils";
import { appendFile } from 'fs';

//pull from config
const REDIS_URL = "127.0.0.1";
const EXPRESS_PORT = "1234";
//15 mins in ms. 
const CACHE_EXPIRY = 1_000 * 60 * 15;

const CHAINS_TO_MONITOR = [1,4,5,42];

interface Healths{
  [key:number] : string[]
}

export class SubgraphHealthEndpont{

constructor(){
 
}

async  connectToRedis(){
  const client = createClient();
  await client.connect();
  client.on('error', (e)=>console.log('couldnt connect to redis instance', e));
  client.on('connected', (c)=>console.log('redis connected',c));
  return client;
}

//parse out name of subgraph
async  getHealthByUri(uri:string){
  const length = uri.length;
  const last = uri.lastIndexOf("/");
  const subgraph = uri.substring(last +1, length);
      
  console.log(`call url @ ${uri}`);
  console.log(`wtih subgraph name ${subgraph}`);
  const health = await getSubgraphHealth(subgraph, uri);
  return (health? health: undefined);

}
//possibly useful
async  determineBestSubgraphProvider(chainId:number){
  const uris = getDeployedSubgraphUri(chainId);
  const health = [];

  let healthiest: { data: { data: { indexingStatusForCurrentVersion: any; }; }; } | undefined = undefined;

  for(const uri of uris){
    const res = await this.getHealthByUri(uri);
    health.push(res);
  }

  health.map((chainHealth, idx)=>{
    console.log(uris[idx]);
    console.log(chainHealth.data.data);

    if(chainHealth.data){
      if(healthiest === undefined){
        healthiest = chainHealth;
        console.log('no old healthiest');
        // console.log(healthiest?.data.data);
      }else{
        //compare health
        const currentHealthiestStatus = healthiest.data.data.indexingStatusForCurrentVersion;
        const status = chainHealth.data.data.indexingStatusForCurrentVersion;

        if(status === null){
          console.log(`no health returned`);
        }else{
          if(currentHealthiestStatus !== null)
          if(parseInt(status.chains[0].latestBlock.number) > parseInt(currentHealthiestStatus.chains[0].latestBlock.number)){
          healthiest = chainHealth;
        }
      }
    }
  }   
  });
  return healthiest;
}

async getHealthForAllChains(){
 
  const healthsByChainId:Healths = {};

  for(const chainId of CHAINS_TO_MONITOR){
    const uris = getDeployedSubgraphUri(chainId);
    const chainHealths:string[] = [];
    for(const uri of uris){
      const chainHealth = await this.getHealthByUri(uri);
      if(chainHealth){
        chainHealths.push(JSON.stringify({url: uri, health: chainHealth}));
      
      }else{console.log(`no chain health available`);
        chainHealths.push(JSON.stringify({url: uri, health: "null"}));
      }
    }
    healthsByChainId[chainId] = chainHealths;
  }
  return healthsByChainId;
  
}

async startExpressEndpoint(redisGetFn:(()=>any)){

  console.log('start express server');
  const app = express();

  app.listen(EXPRESS_PORT, ()=>{
    console.log("express started");
  });
  app.get('/health', async(req, res) => 
    {
      console.log("request to health endpoint");
      res.send(await redisGetFn());
    });

  return app;
}

async init(){
  const client = await this.connectToRedis();
  const app = await this.startExpressEndpoint(async()=>{return await res();});

  //fn to get health of all chains from redis
  const res = async ()=> {return await client.get('health');};
  //set healths of all chains on interval
  let iterations = 0;
  const getHealthInterval = setInterval(async()=>{
    console.log("setting health");
    
    const healths = await this.getHealthForAllChains();
    await client.set('health', JSON.stringify(healths));
  
    //test results
    const r = await axios.get("http://localhost:1234/health");
    console.log(`AXIOS result ${JSON.stringify(r.data)}`);

    iterations++;
    //for testing, sucks to pkill when the process doesnt exit gracefully
    if(iterations > 15){
      clearInterval(getHealthInterval);
      process.exit(1);
    }
  }, 5000);

  getHealthInterval;
}

}

export async function makeServer(){
  const endpoint = new SubgraphHealthEndpont();
  await endpoint.init();
}

makeServer();