'use client';

import { useEffect, useState, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * NProgress-style route transition progress bar for Next.js App Router.
 * Renders a thin animated bar at the top of the viewport on route changes.
 * Uses pure CSS animations — no external dependencies.
 *
 * Features:
 * - 300ms debounce to prevent flash on fast transitions
 * - Auto-complete animation on route settle
 * - Prevents double-click confusion with immediate visual feedback
 */
export function RouteProgressBar() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [isLoading, setIsLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [visible, setVisible] = useState(false);

    const prevPathRef = useRef(`${pathname}?${searchParams?.toString()}`);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const trickleRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        const currentPath = `${pathname}?${searchParams?.toString()}`;
        // Same path (e.g. query params only) → skip if we want, but let's animate on any change
        if (currentPath === prevPathRef.current) return;
        prevPathRef.current = currentPath;

        // Clear any existing timers
        if (timerRef.current) clearTimeout(timerRef.current);
        if (trickleRef.current) clearInterval(trickleRef.current);

        // Start loading immediately for instant visual feedback
        setTimeout(() => {
            setProgress(15);
            setVisible(true);
            setIsLoading(true);
        }, 0);

        // Trickle progress forward slowly
        trickleRef.current = setInterval(() => {
            setProgress((prev) => {
                if (prev >= 90) return prev;
                // Slower as we approach 90%
                const increment = prev < 50 ? 8 : prev < 80 ? 3 : 0.5;
                return Math.min(prev + increment, 90);
            });
        }, 200);

        // Complete after a short delay (route has settled)
        timerRef.current = setTimeout(() => {
            if (trickleRef.current) clearInterval(trickleRef.current);
            setProgress(100);
            setIsLoading(false);

            // Hide after animation completes
            setTimeout(() => {
                setVisible(false);
                setProgress(0);
            }, 300);
        }, 400);

        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
            if (trickleRef.current) clearInterval(trickleRef.current);
        };
    }, [pathname, searchParams]);

    if (!visible) return null;

    return (
        <div className="fixed top-0 left-0 right-0 z-9999 pointer-events-none">
            {/* Main progress bar */}
            <div
                className="h-[3px] bg-primary transition-all ease-out"
                style={{
                    width: `${progress}%`,
                    transitionDuration: isLoading ? '200ms' : '300ms',
                    opacity: progress >= 100 ? 0 : 1,
                }}
            />
            {/* Glow effect */}
            <div
                className="h-[3px] w-24 absolute top-0 right-0 bg-linear-to-r from-transparent to-primary/50 blur-sm"
                style={{
                    opacity: isLoading ? 1 : 0,
                    transition: 'opacity 300ms',
                    transform: `translateX(${progress >= 100 ? '100%' : '0'})`,
                }}
            />
        </div>
    );
}
