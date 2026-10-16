import {expect, it, vi} from "vitest";
import {createCodexMockTestFixture} from "../acp-test-utils";

const id = "11111111-2222-4333-8444-555555555555";
it("reads the exact external thread without loading, resuming or forking it", async () => {
    const fixture = createCodexMockTestFixture();
    const client = fixture.getCodexAcpClient();
    const thread = {id, sessionId: "different-root", turns: [
        {id: "turn-old", items: [{type: "userMessage", id: "u", content: [{type: "text", text: "earlier question"}]}]},
        {id: "turn-current", status: "inProgress", items: [{type: "commandExecution", id: "tool", status: "inProgress", command: "synthetic"}]},
    ]};
    const read = vi.spyOn(client.appServerClient, "threadReadWithHistory").mockResolvedValue({thread} as never);
    const load = vi.spyOn(client, "loadSession");
    const create = vi.spyOn(client, "newSession");
    const result = await fixture.getCodexAcpAgent().extMethod("_session/read_history", {sessionId: id});
    expect(result).toEqual({version: 1, format: "codex-thread", thread, writable: false});
    expect(read).toHaveBeenCalledExactlyOnceWith(id);
    expect(load).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
});

it("refuses an identity mismatch and invalid IDs without returning history", async () => {
    const fixture = createCodexMockTestFixture();
    const read = vi.spyOn(fixture.getCodexAcpClient().appServerClient, "threadReadWithHistory");
    await expect(fixture.getCodexAcpAgent().extMethod("_session/read_history", {sessionId: "../other"})).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    read.mockResolvedValue({thread: {id: "wrong", turns: []}} as never);
    await expect(fixture.getCodexAcpAgent().extMethod("_session/read_history", {sessionId: id})).rejects.toThrow("History unavailable");
});

it("redacts provider failures and never returns partial or oversized history", async () => {
    const fixture = createCodexMockTestFixture();
    const read = vi.spyOn(fixture.getCodexAppServerClient(), "threadReadWithHistory");
    for (const response of [{id, turns: []}, {id, turns: [{text: "x".repeat(8 * 1024 * 1024)}]}]) {
        read.mockResolvedValue({thread: response} as never);
        await expect(fixture.getCodexAcpAgent().extMethod("_session/read_history", {sessionId: id})).rejects.toThrow("History unavailable");
    }
    read.mockRejectedValue(new Error("private credential sentinel"));
    await expect(fixture.getCodexAcpAgent().extMethod("_session/read_history", {sessionId: id})).rejects.not.toThrow("sentinel");
});
