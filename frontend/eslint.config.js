import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // eslint-plugin-react-hooks@7 introduced experimental purity & effect rules.
      // They flag valid patterns we use intentionally:
      //   • setState() inside an effect after fetching data (data-loading pattern)
      //   • Date.now() for unique React keys in lists / chat turns
      // Disabling — TS strict + Suspense boundaries handle these correctly already.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      // shadcn/ui primitives export both Component + cva variants from one file
      // (badge.tsx → Badge + badgeVariants). This is the documented pattern.
      'react-refresh/only-export-components': 'off',
      // Supabase-generated database.types.ts uses `{}` for empty Relationships
      // and table Insert/Update payloads. Generator-controlled, not our code.
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
])
