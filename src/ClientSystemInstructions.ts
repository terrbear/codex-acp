import {RequestError, type ClientCapabilities} from "@agentclientprotocol/sdk";

export const CLIENT_SYSTEM_INSTRUCTIONS = "ahpd.clientSystemInstructions";

export function supportsClientSystemInstructions(capabilities: ClientCapabilities | null | undefined): boolean {
    const value = capabilities?._meta?.[CLIENT_SYSTEM_INSTRUCTIONS];
    return typeof value === "object" && value !== null && (value as {version?: unknown}).version === 1;
}

export function clientSystemInstructions(meta: Record<string, unknown> | null | undefined): string | undefined {
    if (meta === undefined || meta === null || !(CLIENT_SYSTEM_INSTRUCTIONS in meta)) return undefined;
    const value = meta[CLIENT_SYSTEM_INSTRUCTIONS];
    if (typeof value !== "string" || value.trim() === "" || Buffer.byteLength(value, "utf8") > 128 * 1024) {
        throw RequestError.invalidParams(undefined, "Client system instructions must be nonempty text within 128 KiB");
    }
    return value;
}
