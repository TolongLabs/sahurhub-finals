import { describe, expect, test } from 'bun:test'
import { createDiscoveryInfo } from './discovery.ts'

describe('discovery info', () => {
  test('builds phone and mDNS URLs from the selected HTTPS port', () => {
    expect(createDiscoveryInfo(8443, '192.168.43.12')).toEqual({
      phoneUrl: 'https://192.168.43.12:8443/phone',
      mdnsUrl: 'https://sahurhub.local:8443/phone',
      port: 8443
    })
  })
})
