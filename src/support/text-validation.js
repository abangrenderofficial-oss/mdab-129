export function countMeaningfulWords(value = '') {
  const text = String(value || '').normalize('NFKC').trim();
  if (!text) return 0;

  const words = text.match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu) || [];
  return words.length;
}

export function hasMinimumWords(value, minimum = 5) {
  const min = Math.max(1, Number(minimum) || 1);
  return countMeaningfulWords(value) >= min;
}
