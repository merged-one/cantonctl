const [dappSdk, walletSdk] = await Promise.all([
  import('@canton-network/dapp-sdk'),
  import('@canton-network/wallet-sdk'),
])

console.log('Loaded public Canton Network SDK entrypoints for {{PROJECT_NAME}}', {
  dappSdkExports: Object.keys(dappSdk).sort(),
  walletSdkExports: Object.keys(walletSdk).sort(),
})

console.log('Start your wallet flow from these public SDK packages and keep validator-internal wiring out of the default scaffold.')
