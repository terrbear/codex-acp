import {execFile} from "node:child_process";
import {isAbsolute} from "node:path";
import type {ChatgptAuthTokensRefreshParams, ChatgptAuthTokensRefreshResponse} from "./app-server/v2";

export type ExternalAuthRequest = {
    reason: "initial" | "unauthorized";
    previousAccountId: string | null;
    generation: string | null;
};

export type ExternalAuthResult = ChatgptAuthTokensRefreshResponse & {generation: string};
export type ExternalAuth = (request: ChatgptAuthTokensRefreshParams | null) => Promise<ChatgptAuthTokensRefreshResponse>;

export function externalAuthHelper(executable: string): ExternalAuth {
    if (!isAbsolute(executable)) throw new Error("External authentication helper must be an absolute executable path");
    let generation: string | null = null;
    let accountId: string | null = null;
    let pending: Promise<ChatgptAuthTokensRefreshResponse> | undefined;
    return (request) => {
        if (request && request.reason !== "unauthorized") return Promise.reject(new Error("Invalid external authentication refresh reason"));
        if (request?.previousAccountId && accountId && request.previousAccountId !== accountId) {
            return Promise.reject(new Error("External authentication account changed"));
        }
        if (pending) return pending;
        pending = invokeHelper(executable, {
            reason: request?.reason ?? "initial",
            previousAccountId: accountId ?? request?.previousAccountId ?? null,
            generation,
        }).then(result => {
            if (accountId && result.chatgptAccountId !== accountId) throw new Error("External authentication account changed");
            generation = result.generation;
            accountId = result.chatgptAccountId;
            return {accessToken: result.accessToken, chatgptAccountId: accountId, chatgptPlanType: result.chatgptPlanType};
        }).finally(() => { pending = undefined; });
        return pending;
    };
}

function invokeHelper(executable: string, request: ExternalAuthRequest): Promise<ExternalAuthResult> {
    return new Promise((resolve, reject) => {
        const child = execFile(executable, [], {timeout: 8000, killSignal: "SIGKILL", maxBuffer: 65536}, (error, stdout) => {
            if (error) { reject(new Error("External authentication helper unavailable")); return; }
            try {
                const value = JSON.parse(stdout);
                if (!value || typeof value.accessToken !== "string" || !value.accessToken ||
                    typeof value.chatgptAccountId !== "string" || !value.chatgptAccountId ||
                    typeof value.generation !== "string" || !value.generation ||
                    !(value.chatgptPlanType === null || typeof value.chatgptPlanType === "string") ||
                    Object.keys(value).some(key => !["accessToken", "chatgptAccountId", "chatgptPlanType", "generation"].includes(key))) {
                    throw new Error();
                }
                resolve(value);
            } catch { reject(new Error("External authentication helper returned an invalid response")); }
        });
        child.stdin?.on("error", () => {});
        child.stdin?.end(JSON.stringify(request));
    });
}
