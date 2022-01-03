import { BigNumber, constants } from "ethers/lib/ethers";

import {
  GetOutstandingLiquidityParams,
  StoreOutstandingLiquidityParams,
  RemoveOutstandingLiquidityParams,
} from "../../lib/entities";

import { getRedis } from ".";

export const getOutstandingLiquidity = async (g: GetOutstandingLiquidityParams): Promise<BigNumber> => {
  const redis = getRedis();
  const { assetId, chainId } = g;

  // use SCAN to get all the keys for the given assetId and chainId
  const [, keys] = await redis.scan(0, "match", `outstanding-liquidity:${chainId}:${assetId}*`);

  // use a set to get rid of duplicates, apparently SCAN can return duplicated
  // https://redis.io/commands/scan#scan-guarantees
  const amounts = await redis.mget([...new Set(keys)]);
  const num = amounts.filter((x) => !!x).reduce((acc, amount) => acc.add(BigNumber.from(amount)), constants.Zero);
  return num;
};

export const storeOutstandingLiquidity = async (s: StoreOutstandingLiquidityParams): Promise<void> => {
  const redis = getRedis();
  const { amount, transactionId, expiresInSeconds, assetId, chainId } = s;

  // set the key to expire in the given number of seconds
  const key = `outstanding-liquidity:${chainId}:${assetId}:${transactionId}`;
  await redis.setex(key, expiresInSeconds, amount.toString());
};

export const removeOutstandingLiquidity = async (r: RemoveOutstandingLiquidityParams): Promise<void> => {
  const redis = getRedis();
  const { transactionId, assetId, chainId } = r;

  const key = `outstanding-liquidity:${chainId}:${assetId}:${transactionId}`;
  await redis.del(key);
};