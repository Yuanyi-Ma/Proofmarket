import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import hre from "hardhat";

const COBO_WALLET = process.env.COBO_WALLET_ADDRESS ?? "";
const MINT_AMOUNT = 100_000_000n; // 100 mUSDC at 6 decimals

async function main() {
  if (!COBO_WALLET.startsWith("0x") || COBO_WALLET.length !== 42) {
    throw new Error("COBO_WALLET_ADDRESS must be a 42-char 0x address");
  }

  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);

  const usdc = await hre.ethers.deployContract("MockUSDC");
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log(`MockUSDC: ${usdcAddress}`);

  const escrow = await hre.ethers.deployContract("ProofMarketEscrow");
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log(`ProofMarketEscrow: ${escrowAddress}`);

  const mintTx = await usdc.mint(COBO_WALLET, MINT_AMOUNT);
  const mintReceipt = await mintTx.wait();
  console.log(`Minted 100 mUSDC to ${COBO_WALLET}: ${mintReceipt?.hash}`);

  const block = await hre.ethers.provider.getBlockNumber();
  const artifact = {
    chainId: 11155111,
    network: "sepolia",
    deployer: deployer.address,
    blockNumber: block,
    coboWallet: COBO_WALLET,
    contracts: {
      MockUSDC: usdcAddress,
      ProofMarketEscrow: escrowAddress
    },
    mint: {
      to: COBO_WALLET,
      rawAmount: MINT_AMOUNT.toString(),
      txHash: mintReceipt?.hash ?? ""
    },
    deployedAt: new Date().toISOString()
  };

  const outDir = join(process.cwd(), "..", "..", "deployments");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "sepolia.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  console.log("Wrote deployments/sepolia.json");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
