import PopupLoginPage from './PopupLoginPage';


export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    callbackUrl?: string;
    success?: string;
  }>;
}) {
  const _searchParams = await searchParams;

  return <PopupLoginPage searchParams={_searchParams} />
}
