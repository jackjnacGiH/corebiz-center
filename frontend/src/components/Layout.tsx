// Layout has been refactored into ./layout/ — Sidebar + TopBar + composition shell.
// This file re-exports the new Layout so existing imports (App.tsx) keep working.
export { default } from './layout/Layout';
