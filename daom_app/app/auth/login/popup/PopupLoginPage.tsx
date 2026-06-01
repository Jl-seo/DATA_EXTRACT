'use client';

import { Spinner } from '@/components/ui/spinner';
import { signIn } from 'next-auth/react';
import { useEffect } from 'react';

export default function PopupLoginPage({
  searchParams,
}: {
  searchParams: {
    callbackUrl?: string;
    success?: string;
  };
}) {
  useEffect(() => {
    if (searchParams.success) {
      (async () => {
        if (searchParams.callbackUrl === '_parent_call') {
          window.opener.postMessage({
            type: 'LOGIN_SUCCESS',
          });
          window.close();
        }
      })();
    } else {
      signIn('azure-ad', {
        callbackUrl:
          '/auth/login/popup?success=1&callbackUrl=' +
          encodeURIComponent(searchParams.callbackUrl || ''),
      });
    }
  }, [searchParams.success, searchParams.callbackUrl]);

  return (
    <div className='flex h-screen w-screen justify-center bg-white align-middle'>
      <Spinner />
    </div>
  );
}
