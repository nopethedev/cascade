/** Tailwind is compiled to public/tailwind.css. Preflight is disabled because
 * Cascade's existing hand-written theme already owns base element styling;
 * utilities are additive and safe to use on any page. */
export default {
  content: ['./views/**/*.ejs', './public/**/*.js', './public/**/*.mjs'],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        canvas: 'var(--bg)',
        panel: 'var(--surface)',
        ink: 'var(--text)',
        accent: 'var(--accent)',
        ai: {
          bg: 'var(--ai-bg)',
          panel: 'var(--ai-panel)',
          panel2: 'var(--ai-panel-2)',
          line: 'var(--ai-line)',
          'line-soft': 'var(--ai-line-soft)',
          text: 'var(--ai-text)',
          muted: 'var(--ai-muted)',
          dim: 'var(--ai-dim)',
          accent: 'var(--ai-accent)',
          'accent-soft': 'var(--ai-accent-soft)',
          green: 'var(--ai-green)',
          yellow: 'var(--ai-yellow)',
          red: 'var(--ai-red)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        float: '0 18px 60px rgba(0,0,0,.28)',
      },
    },
  },
};
