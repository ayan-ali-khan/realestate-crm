import type { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { created, ok } from '../../http/response.js';
import * as propertiesService from './properties.service.js';

export const list = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await propertiesService.listProperties(req));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  created(res, await propertiesService.createProperty(req));
});

export const addImages = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await propertiesService.addPropertyImages(req));
});

export const removeImage = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await propertiesService.removePropertyImage(req));
});