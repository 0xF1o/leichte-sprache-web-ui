/** Sekunden als Lesbarer Wert formatieren („3 Min 20 s“ bzw. „45 s“). */
export function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} Min ${s} s` : `${s} s`;
}
