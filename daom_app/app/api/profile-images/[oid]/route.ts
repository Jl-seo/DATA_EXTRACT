
import { getCurrentEnvConfig } from '@/lib/env';
import AuthService from '@/services/AuthService';
import MSGraphService from '@/services/MSGraphService';
import { notFound } from 'next/navigation';

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PROFILE_PHOTO_SIZE = 48;

export async function GET() {
  const envConfig = await getCurrentEnvConfig();
  const authService = new AuthService(envConfig);
  const msGraphService = new MSGraphService(envConfig);

  const session = await authService.getSession();

  if (!session?.user.oid) {
    return notFound();
  }

  const graph = await msGraphService.getMSGraphClient();

  try {
    const response: Blob = await graph
      .api(
        `/users/${session.user.oid}/photos/${PROFILE_PHOTO_SIZE}x${PROFILE_PHOTO_SIZE}/$value`,
      )
      .get();
    return new NextResponse(response);
  } catch (error) {
    if ((error as any).statusCode === 404) {
      return notFound();
    }

    throw error;
  }
}
