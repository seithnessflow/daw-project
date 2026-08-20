/**
 * Transport display utilities.
 */

/**
 * Format a sample position as time string.
 */
export function formatTime(samples: number, sampleRate: number): string {
  const totalSeconds = samples / sampleRate;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  const minutesStr = minutes.toString().padStart(2, '0');
  const secondsStr = seconds.toFixed(3).padStart(6, '0');

  return `${minutesStr}:${secondsStr}`;
}

/**
 * Parse a time string to samples.
 */
export function parseTime(timeStr: string, sampleRate: number): number {
  const parts = timeStr.split(':');
  if (parts.length !== 2) return 0;

  const minutes = parseInt(parts[0] ?? '0', 10);
  const seconds = parseFloat(parts[1] ?? '0');

  return Math.floor((minutes * 60 + seconds) * sampleRate);
}
