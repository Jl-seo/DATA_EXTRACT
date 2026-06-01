import { type NextRequest } from 'next/server';
import NextAuth from 'next-auth';
import AuthService from '@/services/AuthService';
import { getCurrentEnvConfig } from '@/lib/env';

interface RouteHandlerContext {
  params: Promise<{ nextauth: string[] }>;
}

async function nextHandler(req: NextRequest, res: RouteHandlerContext) {
  const envConfig = await getCurrentEnvConfig();
  const authService = new AuthService(envConfig);
  const options = await authService.getNextAuthOptions();
  return await NextAuth(req, res, options);
}

export async function GET(req: NextRequest, res: RouteHandlerContext) {
  return await nextHandler(req, res);
}

export async function POST(req: NextRequest, res: RouteHandlerContext) {
  return await nextHandler(req, res);
}
