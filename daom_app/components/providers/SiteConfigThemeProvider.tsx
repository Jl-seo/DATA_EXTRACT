"use client";

import { useEffect } from 'react';
import { useTheme } from 'next-themes';
import useSettings from '@/hooks/useSettings';

export function SiteConfigThemeProvider({ children }: { children: React.ReactNode }) {
    const { theme: configTheme, primaryColor, radius, density: configDensity } = useSettings();
    const { setTheme, resolvedTheme } = useTheme();

    // 1. Sync Theme Mode (Light/Dark/System)
    // Removed to allow user toggle to work without being overridden by config
    /*
    useEffect(() => {
        if (configTheme) {
            setTheme(configTheme);
        }
    }, [configTheme, setTheme]);
    */

    // 2. Sync CSS Variables (Primary Color, Radius, Density)
    useEffect(() => {
        const root = document.documentElement;

        // Apply Radius
        if (radius !== undefined) {
            root.style.setProperty('--radius', `${radius}rem`);
        }

        // Apply Density (Root Font Size)
        // This scales 1rem, affecting all sizing based on rem units
        if (configDensity) {
            let fontSize = '16px'; // normal
            switch (configDensity) {
                case 'compact':
                    fontSize = '14px';
                    break;
                case 'comfortable':
                    fontSize = '18px';
                    break;
                case 'normal':
                default:
                    fontSize = '16px';
                    break;
            }
            root.style.fontSize = fontSize;
        }

        // Apply Primary Color & Derived Colors
        if (primaryColor) {
            // We assume primaryColor is a valid CSS color string (e.g., "oklch(...)")
            // In the 'before' folder, primary/ring/sidebarPrimary were all synced.

            root.style.setProperty('--primary', primaryColor);
            root.style.setProperty('--ring', primaryColor);
            root.style.setProperty('--sidebar-primary', primaryColor);

            // Note: We might want to calculate this dynamically if possible, but for now fixed white/black based on theme is safer
            // root.style.setProperty('--primary-foreground', 'oklch(1 0 0)'); 
        }
    }, [primaryColor, radius, configDensity, resolvedTheme]);

    return <>{children}</>;
}
