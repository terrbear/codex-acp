import type { GetAccountRateLimitsResponse } from "./app-server/v2";

export function codexSubscriptionWindows(response: GetAccountRateLimitsResponse, now: number) {
    const snapshot = response.rateLimitsByLimitId == null
        ? response.rateLimits
        : response.rateLimitsByLimitId["codex"];
    if (snapshot == null || (snapshot.limitId != null && snapshot.limitId !== "codex")) return [];
    return [snapshot.primary, snapshot.secondary].flatMap(window => {
        if (window == null) return [];
        const {usedPercent, windowDurationMins, resetsAt} = window;
        if (!Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100 ||
            windowDurationMins == null || !Number.isSafeInteger(windowDurationMins) ||
            windowDurationMins < 60 || windowDurationMins > 50_400 ||
            resetsAt == null || !Number.isSafeInteger(resetsAt) ||
            resetsAt * 1000 <= now || resetsAt * 1000 > now + windowDurationMins * 60_000 + 300_000) return [];
        return [{used: usedPercent / 100, windowSeconds: windowDurationMins * 60, resetsAt: new Date(resetsAt * 1000).toISOString()}];
    });
}
