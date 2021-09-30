import { ERC20Abi } from "@connext/nxtp-utils";
import { providers, BigNumber, Contract, constants, Wallet } from "ethers";
import contractDeployments from "@connext/nxtp-contracts/deployments.json";

export const TestTokenABI = [
  // Read-Only Functions
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function allowance(address _owner, address _spender) public view returns (uint256 remaining)",

  // Authenticated Functions
  "function approve(address _spender, uint256 _value) public returns (bool success)",
  "function transfer(address to, uint amount) returns (boolean)",
  "function mint(address account, uint256 amount)",
];

export const getDecimals = async (assetId: string, funder: Wallet) => {
  if (assetId === constants.AddressZero) {
    return 18;
  }
  return await new Contract(assetId, ERC20Abi, funder.provider).decimals();
};

export const getOnchainBalance = async (
  assetId: string,
  address: string,
  provider: providers.Provider,
): Promise<BigNumber> => {
  return assetId === constants.AddressZero
    ? provider.getBalance(address)
    : new Contract(assetId, ERC20Abi, provider).balanceOf(address);
};

export const addLiquidity = async (chainId: string, assetId: string, funder: Wallet, amount: string, nonce?: number): Promise<providers.TransactionResponse | undefined> => {
  const record = (contractDeployments as any)[String(chainId)] ?? {};
  const name = Object.keys(record)[0];
  const txmanagerContract = record[name]?.contracts?.TransactionManager;
  const contract = new Contract(txmanagerContract.address, txmanagerContract.abi, funder);
  let res: providers.TransactionResponse | undefined = undefined;
  try {
    res = await contract.addLiquidity(amount, assetId, {
      nonce,
    });
    console.log(res);
  } catch (e) {
    console.error(e);
  }
  return res;
};

export const sendGift = async (
  assetId: string,
  amount: string,
  to: string,
  funder: Wallet,
  nonce?: number,
): Promise<providers.TransactionResponse> => {
  const value = BigNumber.from(amount);
  if (value.eq(0)) {
    throw new Error(`Cannot send gift of 0`);
  }
  const chainId = await funder.getChainId();

  const gasLimit = await estimateGas(funder, { to, value, chainId, data: "0x", from: funder.address });

  const tx = await funder.sendTransaction({ to, value, nonce, gasLimit, chainId });
    // assetId === constants.AddressZero
    //   ? await funder.sendTransaction({ to: recipient, value, nonce, gasLimit, chainId })
    //   : .mint(recipient, BigNumber.from(value), { nonce });
  return tx;
};

const estimateGas = async (funder: Wallet, transaction: any) => {
  const fallbackProvider = funder.provider as providers.FallbackProvider;
  const providers = fallbackProvider.providerConfigs.map(pc => pc.provider);
  const errors: Error[] = [];
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i] as providers.JsonRpcProvider;
    try {
      const args = provider.prepareRequest("estimateGas", { transaction });
      const result = await provider.send(args[0], args[1]);
      return BigNumber.from(result);
    } catch (e) {
      errors.push(e);
    }
  }
  throw new Error(`Could not estimate gas: ${errors.map(e => e.message).join(", ")}`);
};
