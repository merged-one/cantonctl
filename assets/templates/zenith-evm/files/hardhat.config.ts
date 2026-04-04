import {HardhatUserConfig} from 'hardhat/config'

const config: HardhatUserConfig = {
  solidity: '0.8.20',
  networks: {
    zenith: {
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      url: process.env.ZENITH_RPC_URL ?? 'http://localhost:8545',
    },
  },
}

export default config
