'use server';
import { getCurrentEnvConfig } from '@/lib/env';
import BlobStorageService from '@/services/BlobStorageService';
import PermissionService from '@/services/PermissionService';
import 'server-only';

export async function getDownloadUrl(
  folderName: string,
  objectId: string,
  fileName: string
) {
  const envConfig = await getCurrentEnvConfig();

  const permissionService = new PermissionService(envConfig);
  const blobStorageService = new BlobStorageService(envConfig);

  const me = await permissionService.getCurrentUser();

  if (!me) {
    throw new Error('User not found');
  }
  const blobPath = `${envConfig.id}/translations/${folderName}/${objectId}/${decodeURIComponent(fileName)}`

  const blobClient = await blobStorageService.getBlobClient(
    blobPath
  );

  if (!(await blobClient.exists())) {
    return ''
  }

  const url = await blobStorageService.generateSasUrl(
    blobPath,
    BlobStorageService.SAS.READ(60),
  );

  return url
}