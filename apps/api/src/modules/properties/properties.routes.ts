import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import * as propertiesController from './properties.controller.js';
import { validate } from '../../middleware/validate.js';
import { requireRole } from '../../middleware/authenticate.js';
import { AppError, ValidationError } from '../../lib/errors.js';
import {
  createPropertySchema,
  idParamSchema,
  imageIndexParamSchema,
  listPropertiesQuerySchema,
} from './properties.schemas.js';
import { MAX_IMAGES } from './properties.service.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB per file
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Buffered in memory (≤5 MB per file, streamed straight to the CDN by the
// service) — nothing lands on disk and the API secret never leaves the server.
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_IMAGES },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_MIME_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new ValidationError('Only JPEG, PNG, WebP or GIF images are allowed'));
  },
});

// multer's own failures are not AppErrors — translate them so every rejection
// still leaves through the { success, data, error } envelope, never a 500.
function uploadImages(req: Request, res: Response, next: NextFunction) {
  imageUpload.array('images', MAX_IMAGES)(req, res, (err: unknown) => {
    if (err == null) return next();
    if (err instanceof AppError) return next(err);
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `Each image must be ${MAX_IMAGE_BYTES / (1024 * 1024)} MB or smaller`
          : err.code === 'LIMIT_FILE_COUNT'
            ? `Upload at most ${MAX_IMAGES} images at a time`
            : 'Image upload failed';
      return next(new ValidationError(message));
    }
    next(err);
  });
}

export const propertiesRouter = Router();

propertiesRouter.get(
  '/',
  validate({ query: listPropertiesQuerySchema }),
  propertiesController.list,
);

// Listings management: creating inventory and attaching media to it is a
// staff action (ADMIN/MANAGER), same policy as deleting a lead. Reads above
// stay open to every signed-in user — agents need the catalog for inquiries.
propertiesRouter.post(
  '/',
  requireRole('ADMIN', 'MANAGER'),
  validate({ body: createPropertySchema }),
  propertiesController.create,
);
propertiesRouter.post(
  '/:id/images',
  validate({ params: idParamSchema }),
  requireRole('ADMIN', 'MANAGER'),
  uploadImages,
  propertiesController.addImages,
);
propertiesRouter.delete(
  '/:id/images/:index',
  validate({ params: imageIndexParamSchema }),
  requireRole('ADMIN', 'MANAGER'),
  propertiesController.removeImage,
);