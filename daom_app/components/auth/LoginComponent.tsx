'use client';

import { Label } from '@radix-ui/react-label';
import { signIn } from 'next-auth/react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { FileText, Search } from 'lucide-react';
import { useEffect } from 'react';
import { useQueryState } from 'nuqs';
import { isPopupOrIframe } from '@/utils/frameCheck';
import { openCenteredPopup } from '@/utils/popup';
import { useSiteConfig } from '@/queries/env';

export default function LoginComponent() {
  const { data: siteConfig } = useSiteConfig();

  const [callbackUrl] = useQueryState('callbackUrl', { defaultValue: '/' });

  useEffect(() => {
    // iframe 로그인 처리
    function handleMessage(event: MessageEvent) {
      if (event.data.type === 'LOGIN_SUCCESS') {
        window.location.replace(callbackUrl);
      }
    }
    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [callbackUrl]);

  return (
    <>
      {siteConfig.login_icon ? (
        <img src={siteConfig.login_icon?.src} alt="Favicon Preview" className="w-20 h-20 object-contain" />
      ) : (
        <div className="relative mb-2">
          <FileText className="w-20 h-20 text-indigo-600 shrink-0" strokeWidth={1.5} />
          <Search className="absolute -bottom-2 -right-2 w-10 h-10 text-indigo-500 bg-background rounded-full p-1.5 border-[3px] border-background shadow-sm" strokeWidth={3} />
        </div>
      )}
      <div className="flex flex-col items-center mb-3 mt-10">
        <Label htmlFor='sign in text' className='text-3xl font-semibold'>Sign In</Label>
        <div className="flex flex-col my-3 items-center">
          <Label htmlFor='sign in description 1' className='text-sm font-normal'>Access your account using your</Label>
          <Label htmlFor='sign in description 2' className='text-sm font-normal'>company Microsoft login.</Label>
        </div>
      </div>

      <Button size='lg' className="m-1 p-6 font-semibold" variant="outline" onClick={() => {
        if (isPopupOrIframe()) {
          openCenteredPopup(
            '/auth/login/popup?callbackUrl=_parent_call',
            '_blank',
            600,
            700
          );
          return;
        }
        signIn('azure-ad');
      }}>
        <Image alt="Microsoft Logo" width={20} height={20} className="mr-5" src={'/M365.png'} />
        Sign in with Microsoft
      </Button>

    </>
  );
}
