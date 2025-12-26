export function formatWithApostrophe(amount: number, precision: number): string {
    const sign = amount < 0 ? "-" : "";
    const abs = Math.abs(amount);
    const fixed = abs.toFixed(precision);
    const [intPart, fracPart] = fixed.split(".");
    const intWithSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, "’");
    return fracPart !== undefined
        ? `${sign}${intWithSep}.${fracPart}`
        : `${sign}${intWithSep}`;
}
export function parseFlexibleNumber(input: string): number | null {
    const cleaned = input.replace(/\s+/g, "").replace(",", ".");
    const num = parseFloat(cleaned);
    return Number.isNaN(num) ? null : num;
}
export function evaluateMathExpression(raw: string): number | null {
    const normalized = raw
        .replace(/[’']/g, "")
        .replace(/,/g, ".");
    const safe = normalized.replace(/[^0-9+\-*/().\s]/g, "");
    if (!safe.trim())
        return null;
    try {
        const result = Function(`"use strict"; return (${safe})`)();
        if (typeof result !== "number" || Number.isNaN(result) || !Number.isFinite(result)) {
            return null;
        }
        return result;
    }
    catch {
        return null;
    }
}
