import {describe, expect, test} from "vitest";
import {codexSubscriptionWindows} from "../SubscriptionUsage";
import type {GetAccountRateLimitsResponse, RateLimitSnapshot} from "../app-server/v2";

const now = Date.UTC(2026, 10, 21, 12);
const nextHour = now / 1000 + 3600;
const fiveHour = {usedPercent: 4, windowDurationMins: 300, resetsAt: nextHour};
const weekly = {usedPercent: 30, windowDurationMins: 10080, resetsAt: nextHour};
const snapshot = (primary = fiveHour, secondary?: typeof weekly): RateLimitSnapshot => ({
    limitId: "codex", primary, secondary: secondary ?? null, limitName: null, normalModelSlug: null,
    credits: null, individualLimit: null, spendControlReached: null, planType: null, rateLimitReachedType: null,
});
const responseWith = (rateLimits: RateLimitSnapshot, rateLimitsByLimitId: GetAccountRateLimitsResponse["rateLimitsByLimitId"] = null): GetAccountRateLimitsResponse => ({
    rateLimits, rateLimitsByLimitId, ordinaryUsageAllowed: null, rateLimitResetCredits: null, accountId: null, rateLimitUpsell: null,
});

describe("daemon subscription windows", () => {
    test("uses the authoritative Codex bucket rather than the backward-compatible snapshot", () => {
        const response = responseWith(snapshot(), {codex: snapshot(weekly)});
        expect(codexSubscriptionWindows(response, now)).toEqual([
            {used: 0.3, windowSeconds: 604800, resetsAt: new Date(nextHour * 1000).toISOString()},
        ]);
    });

    test("does not fall back when the authoritative view omits Codex", () => {
        const other = {...snapshot(), limitId: "other"};
        const response = responseWith(snapshot(), {other});
        expect(codexSubscriptionWindows(response, now)).toEqual([]);
    });

    test("accepts explicitly reported active windows from old app servers and discards expired windows", () => {
        const response = responseWith(snapshot({...fiveHour, resetsAt: now / 1000}, weekly));
        expect(codexSubscriptionWindows(response, now)).toHaveLength(1);
        expect(codexSubscriptionWindows(response, now)[0]?.windowSeconds).toBe(604800);
    });
});
