import "jsr:@supabase/functions-js/edge-runtime.d.ts";
declare const Deno: any;
type XeResponse = {
    timestamp: number;
    rates: Record<string, number>;
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const XE_AUTH_BASIC = Deno.env.get("XE_AUTH_BASIC") || "";
Deno.serve(async (req) => {
    try {
        if (req.method !== "POST") {
            return new Response(JSON.stringify({ error: "Method not allowed" }), {
                status: 405,
                headers: { "Content-Type": "application/json" },
            });
        }
        const res = await fetch("https://www.xe.com/api/protected/midmarket-converter/", {
            headers: {
                "sec-ch-ua-platform": '"macOS"',
                authorization: XE_AUTH_BASIC,
                Referer: "https://www.xe.com/",
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
                "sec-ch-ua": '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
                "sec-ch-ua-mobile": "?0",
            },
        });
        if (!res.ok) {
            const body = await res.text();
            return new Response(JSON.stringify({ error: "XE fetch failed", status: res.status, body }), {
                status: 502,
                headers: { "Content-Type": "application/json" },
            });
        }
        const data = (await res.json()) as XeResponse;
        if (!data?.timestamp || !data?.rates) {
            return new Response(JSON.stringify({ error: "Malformed XE response" }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
            });
        }
        const ts_ms = data.timestamp;
        const base = "USD";
        const rates = data.rates;
        const rest = async (table: string, body: unknown[], params = "", preferMode?: "merge" | "ignore") => {
            const url = `${SUPABASE_URL}/rest/v1/${table}${params ? `?${params}` : ""}`;
            const res = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    apikey: SUPABASE_SERVICE_ROLE_KEY,
                    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                    ...(preferMode === "merge"
                        ? { Prefer: "resolution=merge-duplicates" }
                        : preferMode === "ignore"
                            ? { Prefer: "resolution=ignore-duplicates" }
                            : {}),
                },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const t = await res.text();
                throw new Error(`REST upsert ${table} failed: ${res.status} ${t}`);
            }
        };
        await rest("fx_snapshot", [{ source: "xe.com", base, ts_ms, rates }]);
        const fetched_at = new Date().toISOString();
        const rows = Object.entries(rates).map(([code, rate]) => ({
            base,
            code,
            rate,
            ts_ms,
            fetched_at,
        }));
        const chunkSize = 500;
        for (let i = 0; i < rows.length; i += chunkSize) {
            const chunk = rows.slice(i, i + chunkSize);
            await rest("fx_rate", chunk, "on_conflict=base,code", "merge");
        }
        return new Response(JSON.stringify({ ok: true, ts_ms, inserted: rows.length }), { headers: { "Content-Type": "application/json" } });
    }
    catch (e) {
        console.error("xe_midmarket error", e);
        return new Response(JSON.stringify({ error: String(e) }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
});
