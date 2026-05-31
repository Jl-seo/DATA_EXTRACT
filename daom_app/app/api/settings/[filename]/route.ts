import { NextRequest, NextResponse } from 'next/server';

import BlobStorageService from '@/services/BlobStorageService';
import { getCurrentEnvConfig } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  const envConfig = await getCurrentEnvConfig();
  const blobStorageService = new BlobStorageService(envConfig);

  const _params = await params;

  const sasUrl = await blobStorageService.generateSasUrl(
    `${envConfig.id}/settings/${_params.filename}`,
    BlobStorageService.SAS.READ(60),
  );

  return NextResponse.redirect(sasUrl);
}
