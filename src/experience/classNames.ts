type ClassValue = string | false | null | undefined;

/** Small dependency-free class combiner for the portable pack experience. */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
