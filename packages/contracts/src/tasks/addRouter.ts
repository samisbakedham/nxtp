import { task } from "hardhat/config";

export default task("add-router", "Add a router")
  .addParam("router", "The router's address to add")
  .addOptionalParam("txManagerAddress", "Override tx manager address")
  .setAction(async ({ router, txManagerAddress: _txManagerAddress }, { deployments, getNamedAccounts, ethers }) => {
    const namedAccounts = await getNamedAccounts();

    console.log("router: ", router);
    console.log("namedAccounts: ", namedAccounts);

    let txManagerAddress = _txManagerAddress;
    if (!txManagerAddress) {
      const txManagerDeployment = await deployments.get("TransactionManager");
      txManagerAddress = txManagerDeployment.address;
    }
    console.log("txManagerAddress: ", txManagerAddress);

    const txManager = await ethers.getContractAt("TransactionManager", txManagerAddress);
    const tx = await txManager.approvedRouters("0x2F1E5F45F805beB66cB0eD037e738a0d9b1A595C");
    console.log("addRouter tx: ", tx);
    // const receipt = await tx.wait();
    // console.log("addRouter tx mined: ", receipt.transactionHash);
    //
    // const isRouterApproved = await txManager.approvedRouters(router);
    // console.log("isRouterApproved: ", isRouterApproved);
  });
