import { randomBytes } from 'node:crypto'
import { AwsClient } from 'aws4fetch'
import { ApiError } from './errors.ts'

/**
 * S3-compatible presigned URLs against a private bucket.
 *
 * Signed with **aws4fetch (~80 KB), not @aws-sdk/client-s3 (~15 MB)**. This is
 * the single most likely dependency to be reached for unthinkingly, and the
 * size difference decides whether the serverless bundle fits at all. Ported
 * from the reference product for exactly that reason.
 *
 * All five variables blank is a **supported state**, not a broken one: the
 * upload endpoint answers 503, the public form says payment proof is
 * unavailable, and registration still works without a screenshot.
 */

const PREFIX = 'payment-proofs/'

/** Deliberately narrow. A payment proof is a photo or a PDF receipt. */
export const ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const
export type AllowedUploadType = (typeof ALLOWED_UPLOAD_TYPES)[number]

/** 8 MB. A phone photo is 2–4 MB; anything far past that is not a receipt. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

const PUT_EXPIRY_SECONDS = 30 * 60
const GET_EXPIRY_SECONDS = 10 * 60

interface StorageConfig {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

function config(): StorageConfig | null {
  const endpoint = process.env.S3_ENDPOINT
  const region = process.env.S3_REGION
  const bucket = process.env.S3_BUCKET
  const accessKeyId = process.env.S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY

  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) return null

  return {
    endpoint: endpoint.replace(/\/+$/, ''),
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
  }
}

/**
 * A feature whose configuration is absent turns itself off and says so, rather
 * than failing at the moment a person reaches for it.
 */
export function storageEnabled(): boolean {
  return config() !== null
}

function client(settings: StorageConfig): AwsClient {
  return new AwsClient({
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
    service: 's3',
    region: settings.region,
  })
}

/** Path-style: `<endpoint>/<bucket>/<key>`. */
function objectUrl(settings: StorageConfig, key: string): string {
  return `${settings.endpoint}/${settings.bucket}/${encodeURI(key)}`
}

const EXTENSIONS: Record<AllowedUploadType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

/**
 * An unguessable key, chosen server-side.
 *
 * This matters more than it looks. With `signQuery: true`, aws4fetch signs only
 * the `host` header — the content type is *not* part of the signature. That was
 * written into three files before a test disproved it. What actually bounds the
 * endpoint is this: the key is chosen here and cannot be guessed, the declared
 * type and size are validated before anything is signed, the request is rate
 * limited, and the bucket is private.
 */
export function newUploadKey(conferenceId: string, contentType: AllowedUploadType): string {
  const random = randomBytes(24).toString('base64url')
  return `${PREFIX}${conferenceId}/${random}.${EXTENSIONS[contentType]}`
}

export interface PresignedUpload {
  uploadUrl: string
  /** What to store on the registration once the PUT succeeds. */
  fileUrl: string
  expiresInSeconds: number
}

export async function presignPut(
  conferenceId: string,
  contentType: string,
  contentLength: number,
): Promise<PresignedUpload> {
  const settings = config()
  if (!settings) {
    throw ApiError.serviceUnavailable(
      'Uploads are not available for this conference. Submit without a payment screenshot.',
    )
  }

  if (!ALLOWED_UPLOAD_TYPES.includes(contentType as AllowedUploadType)) {
    throw ApiError.badRequest('Upload a JPEG, PNG, WebP or PDF')
  }
  if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > MAX_UPLOAD_BYTES) {
    throw ApiError.badRequest(`Files must be under ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`)
  }

  const key = newUploadKey(conferenceId, contentType as AllowedUploadType)
  const url = objectUrl(settings, key)

  const signed = await client(settings).sign(
    new Request(`${url}?X-Amz-Expires=${PUT_EXPIRY_SECONDS}`, { method: 'PUT' }),
    { aws: { signQuery: true } },
  )

  return { uploadUrl: signed.url, fileUrl: url, expiresInSeconds: PUT_EXPIRY_SECONDS }
}

/** A short-lived readable URL, for an organiser reviewing the queue. */
export async function presignGet(fileUrl: string): Promise<string> {
  const settings = config()
  if (!settings) throw ApiError.serviceUnavailable('Uploads are not available')
  if (!isStorageUrl(fileUrl)) throw ApiError.badRequest('That is not a stored file')

  const signed = await client(settings).sign(
    new Request(`${fileUrl}?X-Amz-Expires=${GET_EXPIRY_SECONDS}`, { method: 'GET' }),
    { aws: { signQuery: true } },
  )

  return signed.url
}

/**
 * Whether a URL is one of ours.
 *
 * Requires `https:` and pins the value to the configured bucket **and** prefix.
 * Without it, an arbitrary URL could be stored in `paymentProofUrl` and later
 * clicked by an organiser from the review queue — which is a phishing link
 * delivered through a form the product invites strangers to fill in.
 */
export function isStorageUrl(value: string): boolean {
  const settings = config()
  if (!settings) return false

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }

  if (url.protocol !== 'https:') return false

  const expected = new URL(settings.endpoint)
  if (url.host !== expected.host) return false

  return url.pathname.startsWith(`/${settings.bucket}/${PREFIX}`)
}
