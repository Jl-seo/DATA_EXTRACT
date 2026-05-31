export function openCenteredPopup(
  url: string,
  target: string,
  w: number,
  h: number
) {
  const dualScreenLeft = window.screenX ?? 0;
  const dualScreenTop = window.screenY ?? 0;

  const width =
    window.innerWidth ?? document.documentElement.clientWidth ?? screen.width;
  const height =
    window.innerHeight ??
    document.documentElement.clientHeight ??
    screen.height;

  const left = dualScreenLeft + (width - w) / 2;
  const top = dualScreenTop + (height - h) / 2;

  return window.open(
    url,
    target,
    `scrollbars=yes, width=${w}, height=${h}, top=${top}, left=${left}`
  );
}
