import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge Tailwind class names with intelligent conflict resolution.
 * Used by shadcn/ui components and throughout the app.
 *
 * @example
 *   cn('px-2 py-1', 'px-4') // → 'py-1 px-4'  (px-4 wins)
 *   cn('text-red-500', condition && 'text-blue-500')
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
