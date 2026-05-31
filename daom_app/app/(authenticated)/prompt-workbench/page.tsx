import { notFound } from 'next/navigation';

import { getAppConfig } from '@/actions/env';
import { PromptWorkbenchView } from '@/components/extraction/prompt/PromptWorkbenchView';

export default async function PromptWorkbenchPage() {
  const appConfig = await getAppConfig();
  if (appConfig.features.meta_prompt !== true) {
    notFound();
  }

  return <PromptWorkbenchView />;
}

