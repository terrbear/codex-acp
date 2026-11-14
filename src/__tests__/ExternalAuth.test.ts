import {mkdtemp, writeFile, rm} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, expect, it, vi} from "vitest";
import type {MessageConnection} from "vscode-jsonrpc/node";
import {externalAuthHelper} from "../ExternalAuth";
import {CodexAppServerClient} from "../CodexAppServerClient";
import {CodexAcpClient} from "../CodexAcpClient";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, {recursive: true, force: true}))); });

async function helper(source: string) {
    const dir = await mkdtemp(join(tmpdir(), "external-auth-"));
    directories.push(dir);
    const path = join(dir, "helper");
    await writeFile(path, `#!${process.execPath}\n${source}`, {mode: 0o700});
    return externalAuthHelper(path);
}

it("passes generations without returning them to app-server and coalesces concurrent refresh", async () => {
    const provider = await helper(`let input=''; process.stdin.on('data', c => input+=c); process.stdin.on('end', () => {
        const request=JSON.parse(input);
        process.stdout.write(JSON.stringify({accessToken:request.generation ?? 'initial',chatgptAccountId:'owner',chatgptPlanType:null,generation:'next'}));
    });`);
    expect(await provider(null)).toEqual({accessToken: "initial", chatgptAccountId: "owner", chatgptPlanType: null});
    const first = provider({reason: "unauthorized", previousAccountId: "owner"});
    expect(provider({reason: "unauthorized", previousAccountId: "owner"})).toBe(first);
    expect((await first).accessToken).toBe("next");
    await expect(provider({reason: "unauthorized", previousAccountId: "other"})).rejects.toThrow("account changed");
});

it("rejects token-bearing stderr, malformed output and refresh-token fields without exposing them", async () => {
    const failed = await helper(`process.stderr.write('sensitive-value'); process.exit(1);`);
    await expect(failed(null)).rejects.toThrow(/^External authentication helper unavailable$/);
    const malformed = await helper(`process.stdout.write('sensitive-value');`);
    await expect(malformed(null)).rejects.toThrow(/^External authentication helper returned an invalid response$/);
    const refresh = await helper(`process.stdout.write(JSON.stringify({accessToken:'access',chatgptAccountId:'a',chatgptPlanType:null,generation:'1',refreshToken:'private'}));`);
    await expect(refresh(null)).rejects.toThrow("invalid response");
});

function connection() {
    const handlers = new Map<string, (value: unknown) => Promise<unknown>>();
    const sendRequest = vi.fn(async (method: string) => method === "initialize" ? {codexHome: "/isolated"} : {type: "chatgptAuthTokens"});
    const value = {sendRequest, onUnhandledNotification() {}, onNotification() {}, onDispose() {},
        onRequest(type: {method: string}, handler: (value: unknown) => Promise<unknown>) { handlers.set(type.method, handler); },
    } as unknown as MessageConnection;
    return {value, handlers, sendRequest};
}

it("bootstraps external auth, handles refresh, blocks local writes and preserves authority after restart", async () => {
    const first = connection();
    const provider = vi.fn(async () => ({accessToken: "private", chatgptAccountId: "owner", chatgptPlanType: null}));
    const app = new CodexAppServerClient(first.value);
    const events: unknown[] = [];
    app.onClientTransportEvent(event => events.push(event));
    const client = new CodexAcpClient(app, undefined, undefined, provider);
    await client.initialize({protocolVersion: 1});
    expect(first.sendRequest.mock.calls.map(call => call[0])).toEqual(["initialize", "account/login/start"]);
    expect(JSON.stringify(events)).not.toContain("private");
    await first.handlers.get("account/chatgptAuthTokens/refresh")!({reason: "unauthorized", previousAccountId: "owner"});
    expect(provider).toHaveBeenLastCalledWith({reason: "unauthorized", previousAccountId: "owner"});
    await expect(app.accountLogout()).rejects.toThrow("managed externally");
    await expect(app.accountLogin({type: "chatgptDeviceCode"})).rejects.toThrow("managed externally");
    const second = connection();
    await client.withAppServer(new CodexAppServerClient(second.value)).initialize({protocolVersion: 1});
    expect(second.sendRequest.mock.calls.map(call => call[0])).toEqual(["initialize", "account/login/start"]);
});

it("fails initialization when the authority fails, without starting an alternative login", async () => {
    const server = connection();
    const app = new CodexAppServerClient(server.value);
    app.useExternalAuth(async () => { throw new Error("authority unavailable"); });
    await expect(app.initialize({capabilities: null, clientInfo: {name: "test", version: "1", title: null}})).rejects.toThrow("authority unavailable");
    expect(server.sendRequest.mock.calls.map(call => call[0])).toEqual(["initialize"]);
});

it("refuses direct login and CLI passthrough under an external authority", () => {
    for (const command of ["login", "cli"]) {
        const result = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", command], {
            env: {...process.env, CODEX_AUTH_TOKEN_HELPER: "/unused/helper", APP_SERVER_LOGS: ""}, encoding: "utf8", timeout: 5000,
        });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("Direct CLI authentication is unavailable with an external credential authority");
    }
});
