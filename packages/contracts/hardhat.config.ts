import "@nomicfoundation/hardhat-toolbox";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HardhatUserConfig } from "hardhat/config";

const hardhatOutputRoot = join(tmpdir(), "proofmarket-demo-hardhat");

const sepoliaRpcUrl = process.env.SEPOLIA_RPC_URL ?? "";
const deployerKey = process.env.DEPLOYER_PRIVATE_KEY ?? "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  paths: {
    artifacts: join(hardhatOutputRoot, "artifacts"),
    cache: join(hardhatOutputRoot, "cache")
  },
  typechain: {
    outDir: join(hardhatOutputRoot, "typechain-types")
  },
  networks: {
    sepolia: {
      url: sepoliaRpcUrl,
      accounts: deployerKey ? [deployerKey] : []
    }
  }
};

export default config;
