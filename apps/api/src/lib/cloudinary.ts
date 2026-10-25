// Cloudinary delivery for property images. The SDK is configured lazily from
// env so an unconfigured app still boots; uploads are proxied through this
// server (multer keeps the file in memory) so the API secret never reaches the
// browser — the pattern documented in docs/WALKTHROUGH.md and README.
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';
import { ServiceUnavailableError } from './errors.js';

// public_id prefix for assets this app owns. Deletion is guarded on it, so a
// seed row carrying an Unsplash URL can never destroy somebody else's asset.
export const IMAGES_FOLDER = 'crm-properties';

export function cloudinaryConfigured(): boolean {
  return Boolean(
    env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET,
  );
}

export function assertCloudinaryConfigured(): void {
  if (!cloudinaryConfigured()) {
    throw new ServiceUnavailableError(
      'Image uploads are not configured: set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in apps/api/.env, then restart the API',
    );
  }
}

let configured = false;
function ensureConfigured(): void {
  if (configured) return;
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  configured = true;
}

/** Stream one in-memory image to the CDN and return its delivery URL. */
export async function uploadImage(buffer: Buffer): Promise<string> {
  assertCloudinaryConfigured();
  ensureConfigured();
  return new Promise<string>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: IMAGES_FOLDER, resource_type: 'image' },
      (err, result) => {
        if (err || !result) reject(err ?? new Error('Cloudinary returned no result'));
        else resolve(result.secure_url);
      },
    );
    stream.end(buffer);
  });
}

// The DB stores delivery URLs only (images String[] — no extra column for a
// list the UI already renders), so the public_id is parsed back out of the
// URL. Guarded on our folder prefix: anything else is not ours to delete.
export function publicIdFromUrl(url: string): string | null {
  const marker = '/upload/';
  const cut = url.indexOf(marker);
  if (cut < 0) return null;
  const path = url.slice(cut + marker.length).replace(/^v\d+\//, '');
  if (!path.startsWith(`${IMAGES_FOLDER}/`)) return null;
  return path.replace(/\.[a-z0-9]{2,5}$/i, ''); // delivery extension, not part of the id
}

/**
 * Best-effort CDN delete: the database row is the source of truth, so a failed
 * destroy may orphan an asset but must never fail the request that already
 * committed (or roll back uploads that never reached the DB).
 */
export async function destroyImageByUrl(url: string): Promise<void> {
  if (!cloudinaryConfigured()) return;
  const publicId = publicIdFromUrl(url);
  if (!publicId) return;
  try {
    ensureConfigured();
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
  } catch {
    /* best effort */
  }
}