// SPDX-License-Identifier: GPL-3.0-or-later
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

