#!/usr/bin/env node
/**
 * VoiceLayer API Key Generator
 *
 * Usage:
 *   node scripts/keygen.js              → generates one demo key
 *   node scripts/keygen.js prod         → generates one prod key
 *   node scripts/keygen.js demo 5       → generates 5 demo keys
 *
 * Add the generated key to VOICELAYER_API_KEYS in .env (comma-separated),
 * then redeploy (Railway picks up env changes without a code deploy).
 */

const crypto = require('crypto')

const [,, type = 'demo', countStr = '1'] = process.argv
const count = Math.max(1, parseInt(countStr, 10))

const keys = Array.from({ length: count }, () =>
  `vl-${type}-${crypto.randomBytes(12).toString('hex')}`
)

console.log('\n🔑 Generated VoiceLayer API key(s):\n')
keys.forEach(k => console.log(`   ${k}`))
console.log(`
Add to your .env:
   VOICELAYER_API_KEYS=existing-key,${keys.join(',')}

Then redeploy or restart the server.
`)
