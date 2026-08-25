import crypto from 'node:crypto'

const VERSION = 'v1'
const IV_BYTES = 12

function encryptionKey() {
  const raw = String(process.env.TOKEN_ENCRYPTION_KEY || '').trim()
  if (!raw) throw new Error('TOKEN_ENCRYPTION_KEY is not configured')

  let key
  if (/^[0-9a-f]{64}$/i.test(raw)) key = Buffer.from(raw, 'hex')
  else {
    try { key = Buffer.from(raw, 'base64') } catch { key = null }
  }
  if (!key || key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (openssl rand -hex 32)')
  }
  return key
}

export function isEncryptedToken(value) {
  return String(value || '').startsWith(`${VERSION}:`)
}

export function encryptToken(plaintext) {
  const token = String(plaintext || '').trim()
  if (!token) throw new Error('Cannot encrypt an empty broker token')
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':')
}

export function decryptToken(payload) {
  const value = String(payload || '').trim()
  const [version, ivPart, tagPart, ciphertextPart, ...rest] = value.split(':')
  if (version !== VERSION || !ivPart || !tagPart || !ciphertextPart || rest.length) {
    throw new Error('Stored broker token is not encrypted; reconnect Upstox')
  }
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      Buffer.from(ivPart, 'base64url'),
    )
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch (error) {
    if (/TOKEN_ENCRYPTION_KEY/.test(error?.message || '')) throw error
    throw new Error('Stored broker token could not be decrypted; reconnect Upstox')
  }
}
