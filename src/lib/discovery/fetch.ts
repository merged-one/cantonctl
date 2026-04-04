import {createScanAdapter, type ScanAdapter} from '../adapters/scan.js'

export interface NetworkDiscoverySnapshot {
  dsoInfo: Record<string, unknown>
  scanUrl: string
  scans: unknown[]
  sequencers: unknown[]
}

export interface NetworkDiscoveryFetcher {
  fetch(options: {scanUrl: string; signal?: AbortSignal; token?: string}): Promise<NetworkDiscoverySnapshot>
}

export function createNetworkDiscoveryFetcher(
  deps: {
    createScanAdapter?: (options: Parameters<typeof createScanAdapter>[0]) => ScanAdapter
  } = {},
): NetworkDiscoveryFetcher {
  const createScan = deps.createScanAdapter ?? createScanAdapter

  return {
    async fetch(options) {
      const scan = createScan({
        baseUrl: options.scanUrl,
        token: options.token,
      })
      const [dsoInfo, scans, sequencers] = await Promise.all([
        scan.getDsoInfo(options.signal) as Promise<Record<string, unknown>>,
        scan.listDsoScans(options.signal) as Promise<Record<string, unknown>>,
        scan.listDsoSequencers(options.signal) as Promise<Record<string, unknown>>,
      ])

      return {
        dsoInfo,
        scanUrl: scan.metadata.baseUrl,
        scans: Array.isArray(scans.scans) ? scans.scans : [],
        sequencers: Array.isArray(sequencers.synchronizers) ? sequencers.synchronizers : [],
      }
    },
  }
}

