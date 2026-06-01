import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        spoqa: ['sans-serif'],
      },
      screens: {
        xs: '480px',
        sm: '640px',
        md: '768px',
        lg: '1024px',
        xl: '1280px',
        '2xl': '1536px',
      },
      height: {
        '627': '627',
        '680': '680',
      },
      minWidth: {
        sm: '640px',
        md: '768px',
        lg: '1024px',
        xl: '1280px',
        '2xl': '1536px',
      },
      colors: {
        // Grey Scale
        'grey-10': 'var(--color-grey-10)',
        'grey-15': 'var(--color-grey-15)',
        'grey-20': 'var(--color-grey-20)',
        'grey-25': 'var(--color-grey-25)',
        'grey-30': 'var(--color-grey-30)',
        'grey-40': 'var(--color-grey-40)',
        'grey-50': 'var(--color-grey-50)',
        'grey-60': 'var(--color-grey-60)',
        'grey-70': 'var(--color-grey-70)',
        'grey-80': 'var(--color-grey-80)',
        'grey-85': 'var(--color-grey-85)',
        'grey-90': 'var(--color-grey-90)',
        'grey-95': 'var(--color-grey-95)',

        // layouy
        'layout-stroke': 'var(--color-layout-stroke)',
        'layout-bg-w': 'var(--color-layout-bg-w)',
        'layout-bg-g': 'var(--color-layout-bg-g)',
        'layout-bg-h': 'var(--color-layout-bg-h)',

        // Palette
        'red-00': 'var(--color-palette-red-00)',
        'red-50': 'var(--color-palette-red-50)',
        'red-90': 'var(--color-palette-red-90)',
        'lavender-00': 'var(--color-palette-lavender-00)',
        'lavender-50': 'var(--color-palette-lavender-50)',
        'lavender-90': 'var(--color-palette-lavender-90)',
        'teal-90': 'var(--color-palette-teal-90)',
        'teal-00': 'var(--color-palette-teal-00)',
        'teal-50': 'var(--color-palette-teal-50)',
        'marigold-00': 'var(--color-palette-marigold-00)',
        'marigold-50': 'var(--color-palette-marigold-50)',
        'marigold-90': 'var(--color-palette-marigold-90)',
        'blue-00': 'var(--color-palette-blue-00)',
        'blue-50': 'var(--color-palette-blue-50)',
        'blue-90': 'var(--color-palette-blue-90)',

        // Brand
        'brand-primary-00': 'var(--color-brand-primary-00)',
        'brand-primary-30': 'var(--color-brand-primary-30)',
        'brand-primary-50': 'var(--color-brand-primary-50)',
        'brand-primary-70': 'var(--color-brand-primary-70)',
        'brand-primary-90': 'var(--color-brand-primary-90)',
        'brand-secondary-00': 'var(--color-brand-secondary-00)',
        'brand-secondary-90': 'var(--color-brand-secondary-90)',
        'brand-tertiary-00': 'var(--color-brand-tertiary-00)',
        'brand-tertiary-50': 'var(--color-brand-tertiary-50)',
        'brand-tertiary-90': 'var(--color-brand-tertiary-90)',

        // Systems
        'danger-00': 'var(--color-system-danger-00)',
        'danger-50': 'var(--color-system-danger-50)',
        'danger-90': 'var(--color-system-danger-90)',
        'warning-00': 'var(--color-system-warning-00)',
        'warning-50': 'var(--color-system-warning-50)',
        'warning-90': 'var(--color-system-warning-90)',
        'success-00': 'var(--color-system-success-00)',
        'success-50': 'var(--color-system-success-50)',
        'success-90': 'var(--color-system-success-90)',
        'info-00': 'var(--color-system-info-00)',
        'info-50': 'var(--color-system-info-50)',
        'info-90': 'var(--color-system-info-90)',
      },
      backgroundImage: {
        'gradient-brand':
          'linear-gradient(90deg, var(--color-brand-primary-00) 0%, var(--color-brand-tertiary-00) 100%)',
      },
      boxShadow: {
        basic:
          '0px 0px 2px 0px rgba(0,0,0,0.04),0px 1px 2px 0px rgba(0,0,0,0.08)',
      },
      animation: {
        'gradient-xy': 'gradient-xy 3s ease infinite',
      },
      keyframes: {
        'gradient-xy': {
          '0%, 100%': {
            'background-size': '400% 400%',
            'background-position': '0% 50%',
          },
          '50%': {
            'background-size': '400% 400%',
            'background-position': '100% 50%',
          },
        },
      },
      zIndex: {
        60: '60',
        70: '70',
      },
    },
  },
  plugins: [],
};
export default config;
