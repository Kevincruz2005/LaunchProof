import { randomBytes } from "node:crypto";

const currencies = ["USD", "EUR", "GBP", "SGD", "INR"] as const;

export interface Challenge {
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
}

export function generateChallenges(inputField: string, count = 3, now = new Date()): Challenge[] {
  const seen = new Set<string>();
  const challenges: Challenge[] = [];
  while (challenges.length < count) {
    const entropy = randomBytes(6).toString("hex").toUpperCase();
    if (seen.has(entropy)) continue;
    seen.add(entropy);
    const index = challenges.length;
    const documentId = `LP-${entropy}`;
    const currency = currencies[index % currencies.length] ?? "USD";
    const cents = 10_000 + randomBytes(2).readUInt16BE(0);
    const total = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
    const due = new Date(now);
    due.setUTCDate(due.getUTCDate() + 30 + index * 11);
    const dueDate = due.toISOString().slice(0, 10);
    challenges.push({
      input: {
        [inputField]: `Synthetic invoice ${documentId}; currency ${currency}; total ${total}; due ${dueDate}.`,
      },
      expected: { document_id: documentId, currency, total, due_date: dueDate },
    });
  }
  return challenges;
}

export function observedP95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index] ?? 0;
}
