import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Conditional class names with Tailwind conflict resolution — the helper every
 * shadcn-svelte component imports. `twMerge` is what lets a caller's `class`
 * prop override a component's own utilities rather than fighting them on
 * specificity.
 */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/*
 * Prop-shape helpers used across the generated `ui/` components. They strip the
 * slot props a wrapper handles itself, so a consumer isn't offered a `child`
 * snippet the component never renders.
 */
export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, 'child'> : T;
export type WithoutChildren<T> = T extends { children?: unknown } ? Omit<T, 'children'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;

/** Adds the `ref` binding shadcn-svelte components expose for their root node. */
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
