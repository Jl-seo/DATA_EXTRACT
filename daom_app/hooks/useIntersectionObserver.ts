import { useEffect, useRef } from 'react';

export function useIntersectionObserver(
  callback: IntersectionObserverCallback,
  options?: IntersectionObserverInit,
) {
  const targetRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(callback, options);

    const { current: currentObserver } = observerRef;

    if (targetRef.current) currentObserver.observe(targetRef.current);

    return () => currentObserver.disconnect();
  }, [callback, options]);

  return targetRef;
}
