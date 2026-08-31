/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Bridge the Garra Glass tokens into Tailwind so utilities and hand-written
      // CSS cannot drift apart. Nothing should hardcode a hex outside index.css.
      colors: {
        garra: {
          bg: 'var(--garra-bg)',
          bg2: 'var(--garra-bg-2)',
          panel: 'var(--garra-panel)',
          panel2: 'var(--garra-panel-2)',
          border: 'var(--garra-border)',
          borderStrong: 'var(--garra-border-strong)',
          text: 'var(--garra-text)',
          muted: 'var(--garra-muted)',
          muted2: 'var(--garra-muted-2)',
          primary: 'var(--garra-primary)',
          accent: 'var(--garra-accent)',
          success: 'var(--garra-success)',
          warning: 'var(--garra-warning)',
          danger: 'var(--garra-danger)',
          purple: 'var(--garra-purple)',
        },
      },
      borderRadius: {
        garra: 'var(--garra-radius)',
        garraSm: 'var(--garra-radius-sm)',
      },
      fontFamily: {
        garra: 'var(--garra-font)',
        garraMono: 'var(--garra-mono)',
      },
    },
  },
  plugins: [],
};
