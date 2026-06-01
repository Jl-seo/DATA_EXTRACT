import { NextRequest, NextResponse } from 'next/server';

import BlobStorageService from '@/services/BlobStorageService';
import PermissionService from '@/services/PermissionService';
import { getCurrentEnvConfig } from '@/lib/env';

export const dynamic = 'force-dynamic';

function sanitize(input: string) {
  return input.replace(/(\.\.|\/|\\)/g, '');
}

export async function GET(
  _req: NextRequest,
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
  const _params = await params;

  try {
    const envConfig = await getCurrentEnvConfig();

    const permissionService = new PermissionService(envConfig);
    const blobStorageService = new BlobStorageService(envConfig);

    const me = await permissionService.getCurrentUser();

    if (!me) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 입력값 sanitize
    const folderName = sanitize(_params.folderName);
    const objectId = sanitize(_params.objectId);
    const fileName = sanitize(decodeURIComponent(_params.fileName));

    const blobPath = `${envConfig.id}/translations/${folderName}/${objectId}/${fileName}`;

    const blobClient = await blobStorageService.getBlobClient(blobPath);

    if (!(await blobClient.exists())) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const downloadResponse = await blobClient.download();

    const stream = downloadResponse.readableStreamBody;

    if (!stream) {
      return NextResponse.json(
        { error: 'File stream unavailable' },
        { status: 500 }
      );
    }

    const headers = new Headers();

    headers.set(
      'Content-Type',
      downloadResponse.contentType ?? 'application/octet-stream'
    );

    const originalFilename = fileName.split("_").slice(1).join("_");
    headers.set(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(originalFilename)}`
    );

    headers.set('Cache-Control', 'private, no-store');

    return new NextResponse(stream as unknown as ReadableStream, {
      headers,
    });
  } catch (err) {
    console.error('[DOWNLOAD_ERROR]', err);
    return NextResponse.json(
      { error: 'Failed to download file' },
      { status: 500 }
    );
  }
}
