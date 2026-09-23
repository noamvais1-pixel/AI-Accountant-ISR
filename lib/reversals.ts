/**
 * זיהוי המסמך שחשבונית זיכוי מבטלת.
 *
 * לקארדקום אין שדה "מבטל את מסמך X" בדוח המסמכים. הקשר נלמד מהסימנים
 * שיש: אותו לקוח, אותו סכום, והזיכוי הופק אחרי המקור. כשיש כמה מועמדים,
 * האחרון שהופק לפני הזיכוי הוא הסביר ביותר. מסמך שכבר בוטל בזיכוי אחר אינו
 * מועמד — זיכוי אחד לכל מסמך.
 */

export type ReversalCandidate = {
  id: string;
  issueDate: Date;
  totalAgorot: number;
  counterpartyName: string;
  counterpartyVatId: string | null;
  isCredit: boolean;
  alreadyReversed: boolean;
};

export type CreditToLink = {
  issueDate: Date;
  totalAgorot: number;
  counterpartyName: string;
  counterpartyVatId: string | null;
};

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

export function sameCounterparty(a: CreditToLink, b: ReversalCandidate): boolean {
  const idA = norm(a.counterpartyVatId);
  const idB = norm(b.counterpartyVatId);
  if (idA && idB) return idA === idB;
  return norm(a.counterpartyName) !== '' && norm(a.counterpartyName) === norm(b.counterpartyName);
}

export function pickReversedDocument<T extends ReversalCandidate>(credit: CreditToLink, candidates: T[]): T | null {
  const eligible = candidates.filter(
    (c) =>
      !c.isCredit &&
      !c.alreadyReversed &&
      c.totalAgorot === credit.totalAgorot &&
      c.issueDate.getTime() <= credit.issueDate.getTime() &&
      sameCounterparty(credit, c),
  );
  if (eligible.length === 0) return null;
  return eligible.reduce((best, c) => (c.issueDate.getTime() > best.issueDate.getTime() ? c : best));
}
