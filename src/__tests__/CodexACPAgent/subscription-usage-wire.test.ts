import {spawn} from "node:child_process";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import * as acp from "@agentclientprotocol/sdk";
import {expect, it} from "vitest";
import {createJsonStream} from "../../StdUtils";

it("reads only the adapter's provider quota over the ACP wire", async () => {
    const dir = await mkdtemp(join(tmpdir(), "subscription-wire-"));
    const fixture = join(dir, "app-server.mjs");
    const receipt = join(dir, "methods");
    await writeFile(fixture, `#!/usr/bin/env node
import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
createInterface({input:process.stdin}).on('line', line => {
    const request = JSON.parse(line);
    appendFileSync(process.env.SUBSCRIPTION_TEST_RECEIPT, request.method + '\\n');
    if (request.id === undefined) return;
    const resetsAt = Math.floor(Date.now() / 1000) + 600;
    const usage = {usedPercent: 30, windowDurationMins: 10080, resetsAt};
    const account = {type: 'chatgpt', email: 'owner@example.com', planType: 'plus'};
    const replies = {
        initialize: {userAgent: 'fixture', codexHome: null},
        'account/read': {account, requiresOpenaiAuth: false},
        'config/read': {config: {}, origins: {}},
        'account/rateLimits/read': {
            rateLimits: {limitId: 'codex', primary: {...usage, windowDurationMins: 300}},
            rateLimitsByLimitId: {codex: {limitId: 'codex', primary: usage}},
        },
    };
    const result = replies[request.method];
    const message = result === undefined ? {error: {code: -32601, message: 'Unexpected fixture method'}} : {result};
    process.stdout.write(JSON.stringify({jsonrpc: '2.0', id: request.id, ...message}) + '\\n');
});
`, {mode: 0o755});
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
        env: {...process.env, CODEX_PATH: fixture, APP_SERVER_LOGS: "", SUBSCRIPTION_TEST_RECEIPT: receipt},
        stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr.resume();
    const connection = acp.client().connect(createJsonStream(child.stdout, child.stdin));
    try {
        const init = await connection.agent.request<acp.InitializeResponse>("initialize", {
            protocolVersion: 1, clientCapabilities: {_meta: {"ahpd.subscriptionUsage": 1}},
        });
        expect(init.agentCapabilities?._meta?.["subscriptionUsage"]).toEqual({version: 1});
        const usage = await connection.agent.request("_account/subscription_usage", {});
        expect(usage).toMatchObject({
            status: "verified", name: "owner@example.com", windows: [{windowSeconds: 604800, used: 0.3}],
        });
        const methods = (await readFile(receipt, "utf8")).trim().split("\n");
        expect(methods.filter(method => method === "account/rateLimits/read")).toHaveLength(1);
        expect(methods.filter(method => !["initialize", "initialized", "account/read", "config/read", "account/rateLimits/read"].includes(method))).toEqual([]);
    } finally {
        child.stdin.end();
        child.kill();
        await new Promise<void>(resolve => {
            if (child.exitCode !== null || child.signalCode !== null) resolve();
            else child.once("exit", () => resolve());
        });
        await rm(dir, {recursive: true, force: true});
    }
}, 45_000);
