/** "98300 •••21" — first 5 digits, dots, last 2. Applied in the serializer, not only in the UI. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '').slice(-10);
  if (digits.length < 7) return '•••';
  return `${digits.slice(0, 5)} •••${digits.slice(-2)}`;
}

/** ₹ Lakh / Crore label used in summaries (the UI formats its own). */
export function inrShort(value: number | null | undefined): string {
  if (value == null) return '—';
  if (value >= 1e7) return `₹${(value / 1e7).toFixed(2).replace(/\.?0+$/, '')} Cr`;
  if (value >= 1e5) return `₹${(value / 1e5).toFixed(2).replace(/\.?0+$/, '')} L`;
  if (value >= 1e3) return `₹${(value / 1e3).toFixed(1).replace(/\.0$/, '')} k`;
  return `₹${value}`;
}

export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
