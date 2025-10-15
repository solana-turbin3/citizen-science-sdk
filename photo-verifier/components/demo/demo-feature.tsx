import { AppView } from '@/components/app-view'
import { AppText } from '@/components/app-text'
import { BaseButton } from '@/components/solana/base-button'
import { blake3 } from '@noble/hashes/blake3'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'
import * as React from 'react'

export function DemoFeature() {
  const [result, setResult] = React.useState<string>('')
  const [error, setError] = React.useState<string | null>(null)

  const onPress = React.useCallback(async () => {
    setError(null)
    setResult('')
    try {
      const expected = 'ea8f163db38682925e4491c5e58d4bb3506ef8c14eb78a86e908c5624a67200f'
      const actualHex = bytesToHex(blake3(utf8ToBytes('hello')))
      const ok = actualHex === expected
      setResult(ok ? `OK: ${actualHex}` : `Mismatch: ${actualHex}`)
      console.log('BLAKE3("hello") =', actualHex)
    } catch (e: any) {
      console.error('BLAKE3 demo error', e)
      setError(e?.message ?? 'Unknown error')
    }
  }, [])

  return (
    <AppView>
      <AppText type="subtitle">Demo page</AppText>
      <AppText>Assert BLAKE3("hello") equals expected hex.</AppText>
      <BaseButton label="Run BLAKE3 assert" onPress={onPress} />
      {error ? <AppText style={{ color: '#B00020' }}>Error: {error}</AppText> : null}
      {result ? <AppText>{result}</AppText> : null}
    </AppView>
  )
}
