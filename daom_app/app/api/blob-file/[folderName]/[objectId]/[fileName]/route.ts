import { NextRequest, NextResponse } from 'next/server';

import BlobStorageService from '@/services/BlobStorageService';
import PermissionService from '@/services/PermissionService';
import { getCurrentEnvConfig } from '@/lib/env';

export async function GET(
  req: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      folderName: string;
      objectId: string;
      fileName: string;
    }>;
  }
) {
  const envConfig = await getCurrentEnvConfig();
  const _params = await params;

  const permissionService = new PermissionService(envConfig);
  const blobStorageService = new BlobStorageService(envConfig);

  const me = await permissionService.getCurrentUser();

  if (!me) {
    throw new Error('User not found');
  }
  const blobPath = `${envConfig.id}/translations/${_params.folderName}/${_params.objectId}/${decodeURIComponent(_params.fileName)}`

  const blobClient = await blobStorageService.getBlobClient(
    blobPath
  );

  if (!(await blobClient.exists())) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const url = await blobStorageService.generateSasUrl(
    blobPath,
    BlobStorageService.SAS.READ(60),
  );

  return NextResponse.redirect(url);
}
