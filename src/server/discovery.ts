import { networkInterfaces } from 'node:os'

export interface DiscoveryInfo {
  phoneUrl: string
  mdnsUrl: string
  port: number
}

export function getLanIp(): string {
  try {
    for (const interfaces of Object.values(networkInterfaces())) {
      for (const network of interfaces ?? []) {
        if (network.family === 'IPv4' && !network.internal) return network.address
      }
    }
  } catch {
    // Sandboxed hosts may deny interface enumeration; the local fallback keeps
    // `/info` usable in development while real devices still publish their LAN IP.
  }
  return '127.0.0.1'
}

export function createDiscoveryInfo(port: number, lanIp = getLanIp()): DiscoveryInfo {
  const portSuffix = port === 443 ? '' : `:${port}`
  return {
    phoneUrl: `https://${lanIp}${portSuffix}/phone`,
    mdnsUrl: `https://sahurhub.local${portSuffix}/phone`,
    port
  }
}
