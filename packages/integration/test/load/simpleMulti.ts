import { BigNumber, constants, providers, Signer, utils, Wallet } from "ethers";
import { ActiveTransaction, NxtpSdk, NxtpSdkEvents, HistoricalTransaction, CrossChainParams } from "@connext/nxtp-sdk";
import {
    AuctionResponse,
    ChainData,
    CrosschainTransaction,
    getRandomBytes32,
    Logger,
    TransactionData,
    TransactionPreparedEvent,
} from "@connext/nxtp-utils";

const CHAIN_CONFIG = '{"4":"https://rinkeby.infura.io/v3/d1caeba320f94122ba8f791f50122c4c","5":"https://goerli.infura.io/v3/d1caeba320f94122ba8f791f50122c4c"}';
const SWAP_CONFIG = '[{\n' +
    '\t"name": "TEST",\n' +
    '\t"assets": [{\n' +
    '\t\t"4": "0x9aC2c46d7AcC21c881154D57c0Dc1c55a3139198",\n' +
    '\t\t"5": "0x8a1Cad3703E0beAe0e0237369B4fcD04228d1682"\n' +
    '\t}]\n' +
    '}]'

export type SwapConfig = { name: string; assets: { [chainId: number]: string } };
export const swapConfig: SwapConfig[] = JSON.parse(SWAP_CONFIG!);

const testConstants = {
    //initial chain we start on
    sendingChain: 4,
    receivingChain: 5
}
type nxtpProviderProps = {
    web3Provider: providers.Web3Provider;
    signer: Signer;
    chainData: ChainData[];
}

const chainConfig: Record<
    number,
    { provider: string[]; subgraph?: string; transactionManagerAddress?: string }
    > = JSON.parse(CHAIN_CONFIG!);


const txManagerAddressSending = "0xb6cb4893F7e27aDF1bdda1d283A6b344A1F57D58";
const txManagerAddressReceiving = txManagerAddressSending;

const SENDING_CHAIN = 4;
const RECEIVING_CHAIN = 5;

const chainProviders = {
    [SENDING_CHAIN]: {
        provider: new providers.FallbackProvider([
            new providers.StaticJsonRpcProvider("https://rinkeby.infura.io/v3/d1caeba320f94122ba8f791f50122c4c", SENDING_CHAIN),
        ]),
        transactionManagerAddress: txManagerAddressSending,
    },
    [RECEIVING_CHAIN]: {
        provider: new providers.FallbackProvider([
            new providers.StaticJsonRpcProvider('https://goerli.infura.io/v3/d1caeba320f94122ba8f791f50122c4c', RECEIVING_CHAIN),
        ]),
        transactionManagerAddress: txManagerAddressReceiving,
    },
};



// Object.entries(chainConfig).forEach(([chainId, { provider, subgraph, transactionManagerAddress }]) => {
//     chainProviders[parseInt(chainId)] = {
//         provider: new providers.FallbackProvider(
//             provider.map((p) => new providers.StaticJsonRpcProvider(p, parseInt(chainId))),
//         ),
//         subgraph,
//         transactionManagerAddress,
//     };
// });

const findAssetInSwap = (crosschainTx: CrosschainTransaction) =>
    swapConfig.find((sc) =>
        Object.values(sc.assets).find(
            (a) => utils.getAddress(a) === utils.getAddress(crosschainTx.invariant.sendingAssetId),
        ),
    )?.name ?? "UNKNOWN";

class NXTPSimpleMulti
{
    private chainId: any;
    private sdk: NxtpSdk | undefined;
    //storage that mocks the React state
    public activeTxns: ActiveTransaction[] | undefined;
    private activeTransferTableColumns: any[] = [];
    private injectedProviderChainId:number = 0;
    private auctionResponse:AuctionResponse | undefined = undefined;

    // private readonly Logger:Logger

    async init ({web3Provider, signer, chainData}: nxtpProviderProps) {
        // console.log("signer: ", signer);
        // console.log("web3Provider: ", web3Provider);
        if (!signer || !web3Provider) {
            return;
        }
        this.chainId = await signer.provider!.getNetwork();
        // console.log("chainId: ", this.chainId);
        //
        // console.log("sendingChain: ", testConstants.sendingChain);

        const address = await signer.getAddress();
        console.log(`Address of transfer agent ${address}`);

        // const _balance = await getUserBalance(sendingChain, signer);
        // setUserBalance(_balance);
        const cd = await utils.fetchJson("https://raw.githubusercontent.com/connext/chaindata/main/crossChain.json");


        const _sdk = new NxtpSdk({
            chainConfig: chainProviders,
            signer,
            messaging: undefined,
            natsUrl: process.env.REACT_APP_NATS_URL_OVERRIDE,
            authUrl: process.env.REACT_APP_AUTH_URL_OVERRIDE,
            logger: new Logger({level: "debug"}),
            network: "testnet",
        });
        this.sdk = _sdk;
        // this.activeTxns = await _sdk.getActiveTransactions();
        this.activeTxns = []

        // TODO: race condition with the event listeners
        // Will not update the transactions appropriately if sender tx prepared and no txs set
        console.log("activeTxs: ", this.activeTxns);

        // const convertedActiveTxs = await Promise.all(
        //     this.activeTxns.map(async (tx) => {
        //         let gasAmount = "0";
        //         if (tx.status === NxtpSdkEvents.ReceiverTransactionPrepared) {
        //             const { receiving, invariant } = tx.crosschainTx;
        //             const receivingTxData =
        //                 typeof receiving === "object"
        //                     ? {
        //                         ...invariant,
        //                         ...receiving,
        //                     }
        //                     : undefined;
        //
        //             try {
        //                 const gasAmountInBigNum = await _sdk?.estimateFulfillFee(receivingTxData as TransactionData, "0x", "0");
        //                 gasAmount = utils.formatEther(gasAmountInBigNum);
        //             } catch (e) {
        //                 console.log(e);
        //             }
        //         }
        //
        //         // Use receiver side info by default
        //         const variant = tx.crosschainTx.receiving ?? tx.crosschainTx.sending;
        //         return {
        //             sentAmount: utils.formatEther(tx.crosschainTx.sending?.amount ?? "0"),
        //             receivedAmount: utils.formatEther(tx.crosschainTx.receiving?.amount ?? "0"),
        //             gasAmount: gasAmount,
        //             status: tx.status,
        //             sendingChain: tx.crosschainTx.invariant.sendingChainId.toString(),
        //             receivingChain: tx.crosschainTx.invariant.receivingChainId.toString(),
        //             asset: findAssetInSwap(tx.crosschainTx),
        //             key: tx.crosschainTx.invariant.transactionId,
        //             preparedAt: tx.preparedTimestamp,
        //             expires:
        //                 variant.expiry > Date.now() / 1000
        //                     ? `${((variant.expiry - Date.now() / 1000) / 3600).toFixed(2)} hours`
        //                     : "Expired",
        //             action: tx,
        //         };
        //     }),
        // );
        //
        //


        _sdk.attach(NxtpSdkEvents.SenderTransactionPrepared, (data) => {
            console.log("SenderTransactionPrepared:", data);
            const {amount, expiry, preparedBlockNumber, ...invariant} = data.txData;
            this.activeTxns = [];
            let activeTxn = {
                crosschainTx: {
                    invariant,
                    sending: {amount, expiry, preparedBlockNumber},
                },
                preparedTimestamp: Math.floor(Date.now() / 1000),
                bidSignature: data.bidSignature,
                encodedBid: data.encodedBid,
                encryptedCallData: data.encryptedCallData,
                status: NxtpSdkEvents.SenderTransactionPrepared,
            };
            this.activeTxns.push(activeTxn);

        });
    }
    //
    // _sdk.attach(NxtpSdkEvents.SenderTransactionFulfilled, (data) => {
    //     console.log("SenderTransactionFulfilled:", data);
    //     this.activeTransferTableColumns.push(
    //         this.activeTransferTableColumns.filter(
    //             (t) => t.crosschainTx.invariant.transactionId !== data.txData.transactionId,
    //         ),
    //     );
    // });
    //
    // _sdk.attach(NxtpSdkEvents.SenderTransactionCancelled, (data) => {
    //     console.log("SenderTransactionCancelled:", data);
    //     this.activeTransferTableColumns.push(
    //         this.activeTransferTableColumns.filter(
    //             (t) => t.crosschainTx.invariant.transactionId !== data.txData.transactionId,
    //         ),
    //     );
    // });
    //
    // _sdk.attach(NxtpSdkEvents.ReceiverTransactionPrepared, (data) => {
    //     console.log("ReceiverTransactionPrepared:", data);
    //     const { amount, expiry, preparedBlockNumber, ...invariant } = data.txData;
    //     const index = this.activeTransferTableColumns.findIndex(
    //         (col) => col.crosschainTx.invariant.transactionId === invariant.transactionId,
    //     );
    //
    //     const table = [...this.activeTransferTableColumns];
    //     if (index === -1) {
    //         // TODO: is there a better way to
    //         // get the info here?
    //         table.push({
    //             preparedTimestamp: Math.floor(Date.now() / 1000),
    //             crosschainTx: {
    //                 invariant,
    //                 sending: {} as any, // Find to do this, since it defaults to receiver side info
    //                 receiving: { amount, expiry, preparedBlockNumber },
    //             },
    //             bidSignature: data.bidSignature,
    //             encodedBid: data.encodedBid,
    //             encryptedCallData: data.encryptedCallData,
    //             status: NxtpSdkEvents.ReceiverTransactionPrepared,
    //         });
    //         this.activeTransferTableColumns.push(table);
    //     } else {
    //         const item = { ...table[index] };
    //         table[index] = {
    //             ...item,
    //             status: NxtpSdkEvents.ReceiverTransactionPrepared,
    //             crosschainTx: {
    //                 ...item.crosschainTx,
    //                 receiving: { amount, expiry, preparedBlockNumber },
    //             },
    //         };
    //         this.activeTransferTableColumns.push(table);
    //     }
    // });
    //
    // _sdk.attach(NxtpSdkEvents.ReceiverTransactionFulfilled, async (data) => {
    //     console.log("ReceiverTransactionFulfilled:", data);
    //     // setActiveTransferTableColumns(
    //     //   activeTransferTableColumns.filter(
    //     //     (t) => t.crosschainTx.invariant.transactionId !== data.txData.transactionId,
    //     //   ),
    //     // );
    //
    //     // const historicalTxs = await _sdk.getHistoricalTransactions();
    //     // setHistoricalTransferTableColumns(historicalTxs);
    //     // console.log("historicalTxs: ", historicalTxs);
    // });
    //
    // _sdk.attach(NxtpSdkEvents.ReceiverTransactionCancelled, (data) => {
    //     console.log("ReceiverTransactionCancelled:", data);
    //     // setActiveTransferTableColumns(
    //     //     activeTransferTableColumns.filter(
    //     //         (t) => t.crosschainTx.invariant.transactionId !== data.txData.transactionId,
    //     //     ),
    //     // );
    // });
    //
    // _sdk.attach(NxtpSdkEvents.SenderTokenApprovalMined, (data) => {
    //     console.log("SenderTokenApprovalMined:", data);
    // });
    //
    // _sdk.attach(NxtpSdkEvents.SenderTransactionPrepareSubmitted, (data) => {
    //     console.log("SenderTransactionPrepareSubmitted:", data);
    // });
    // };

    constructor(provider: nxtpProviderProps) {
        // console.log("signer: ", provider.signer);
        // console.log("web3Provider: ", provider.web3Provider);
        if (!provider.signer || !provider.web3Provider) {
            return;
        }
        this.init(provider).then((res)=>console.log(`initalized`));
    }

    async getTransferQuote (
    sendingChainId: number,
    sendingAssetId: string,
    receivingChainId: number,
    receivingAssetId: string,
    amount: string,
    receivingAddress: string,
    preferredRouter?: string,
): Promise<AuctionResponse | undefined>{
    if (!this.sdk) {
        return;
    }

    // if (this.injectedProviderChainId !== sendingChainId) {
    //     console.log("Please switch chains to the sending chain!");
    //     throw new Error("Wrong chain");
    // }

    // Create txid
    const transactionId = getRandomBytes32();

    const params:CrossChainParams = {
        callData:undefined,
        sendingChainId:sendingChainId,
        sendingAssetId:sendingAssetId,
        receivingChainId:receivingChainId,
        receivingAssetId:receivingAssetId,
        callTo:undefined,
        receivingAddress:receivingAddress,
        amount:amount,
        expiry: Math.floor(Date.now() / 1000) + 3600 * 24 * 3, // 3 days
        transactionId: transactionId,
        // preferredRouter,

    }

    const response = await this.sdk.getTransferQuote(params);
    this.auctionResponse = response;
    return response;
};
    async transfer(quote:AuctionResponse){
        if(!this.sdk){
            return;
        }
        if(!this.auctionResponse){
            console.log(`cant transfer without an auction response`);
            throw new Error("Please request quote first");
        }
        if (this.injectedProviderChainId !== this.auctionResponse.bid.sendingChainId) {
            console.log("Please switch chains to the sending chain!");
            throw new Error("Wrong chain");
        }

        const transfer = await this.sdk.prepareTransfer(quote, true);
        console.log("transfer: ", transfer);


        this.auctionResponse = undefined;
        return transfer;
    }

    async finishTransfer({
        bidSignature,
        encodedBid,
        encryptedCallData,
        txData,
        }: Omit<TransactionPreparedEvent, "caller">) {
        if (!this.sdk) {
            return;
        }

        const finish = await this.sdk.fulfillTransfer({bidSignature, encodedBid, encryptedCallData, txData});
        console.log("finish: ", finish);
        if (finish.metaTxResponse?.transactionHash || finish.metaTxResponse?.transactionHash === "") {

        const finishedTxn = this.activeTransferTableColumns.filter((t) => {
                t.crosschainTx.invariant.transactionId !== txData.transactionId
        })

        console.log(`Removing finised transfer from axtive transfer ${finishedTxn}`);
        const i = this.activeTransferTableColumns.indexOf(finishedTxn);
        if(i > -1){
            this.activeTransferTableColumns.splice(i, 1);
        }


        }
    }
}


async function main() {
    console.log(`newnewnew`)
    const chainData = await utils.fetchJson("https://raw.githubusercontent.com/connext/chaindata/main/crossChain.json");

    const providerUrls = JSON.parse(CHAIN_CONFIG);
    if(!providerUrls){
        return;
    }
    const sendingProvider = new providers.JsonRpcProvider(providerUrls[4]) as providers.Web3Provider;
    console.log(`Sending Provider ${sendingProvider}`)
    const signer =  Wallet.fromMnemonic(mnemonic,`m/44'/60'/0'/0/1`);

    const wallet = signer.connect(sendingProvider)
    const nxtpProps:nxtpProviderProps = {web3Provider:sendingProvider, signer:wallet, chainData}

    const test = new NXTPSimpleMulti(nxtpProps);

    await test.init(nxtpProps);

    const quote = await test.getTransferQuote(
        4,
        "0x9aC2c46d7AcC21c881154D57c0Dc1c55a3139198",
        5,
        "0x8a1Cad3703E0beAe0e0237369B4fcD04228d1682",
        utils.parseEther("10").toString(),
        "0x40E66C3EC2635FDdbfd2c8097904Ad5097B171d4"

    )
    if(quote) {
        console.log(`Quote: ${JSON.stringify(quote)}`)
    }
    // console.log(`newnewnew`)
    const transfer = await test.transfer(quote!);
    //
    // if(transfer){
    //     console.log(`Transfer ${transfer}`);
    //     //wait for active tx event
    //     while(!test.activeTxns){
    //         await setTimeout(()=>{console.log(`Waiting for sendertxnprepared`)}, 2500);
    //     }
    // }
}

main().then(()=>{"starting main"})

