export function mergeObjects(a: any, b: any): any {
  if (
    Array.isArray(a) ||
    Array.isArray(b) ||
    typeof a === 'string' ||
    typeof b === 'string' ||
    typeof a === 'function' ||
    typeof b === 'function'
  ) {
    return [a, b];
  }
  const result = { ...a, ...b };
  for (const key of Object.keys(a)) {
    if (key in b) {
      result[key] = mergeObjects(a[key], b[key]);
    }
  }
  return result;
}
