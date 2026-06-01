export function isPopupWindow(): boolean {
  if (typeof window === "undefined") return false;

  try {
    return !!window.opener && window.opener !== window;
  } catch {
    return false;
  }
}

export function isInIframe(): boolean {
  if (typeof window === "undefined") return false;

  try {
    if (window.parent !== window) {
      // parent 가 다르면 대부분 "iframe 안"이라서 바로 true 반환
      return true;
    }
    // - 일부 브라우저/확장/샌드박스 환경에서 parent 가 항상 자기 자신으로 보이는 경우 있음
  } catch {
    // 보안 정책으로 parent 접근이 막힌 경우 → 상위 창이 있다고 보고 iframe 으로 간주
    return true;
  }

  // 2) frameElement 확인
  try {
    if (typeof window.frameElement !== "undefined" && window.frameElement != null) {
      // frameElement 가 있으면 확실히 iframe 이라서 바로 true 반환
      return true;
    }
    // - 브라우저/버전/샌드박스에 따라 frameElement 가 항상 null 로 나오는 경우 있음
  } catch {
    // 보안 정책으로 frameElement 접근이 막힌 경우 → 상위 프레임이 있다고 보고 iframe 으로 간주
    return true;
  }

  try {
    if (window.self !== window.top) {
      // 서로 다르면 중간 어딘가 iframe 계층 안에 있다는 뜻 → 바로 true 반환
      return true;
    }
    // 일부 확장/특수 샌드박스 환경에서 top 이 래핑된 객체로 동작해 항상 self 와 같게 보이는 경우가 있음
  } catch {
    // 보안 정책으로 top 접근이 막힌 경우 → 상위 창이 있다고 보고 iframe 으로 간주
    return true;
  }

  return false;
}

export function isPopupOrIframe(): boolean {
  return isPopupWindow() || isInIframe();
}
