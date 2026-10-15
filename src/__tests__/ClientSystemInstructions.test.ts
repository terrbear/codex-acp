import {describe, expect, it} from "vitest";
import {clientSystemInstructions, supportsClientSystemInstructions} from "../ClientSystemInstructions";

describe("client system instructions", () => {
    it("preserves exact text and enforces the UTF-8 byte limit", () => {
        const text = "  Required guidance.\n";
        expect(clientSystemInstructions({"ahpd.clientSystemInstructions": text})).toBe(text);
        expect(clientSystemInstructions({"ahpd.clientSystemInstructions": "é".repeat(65536)})).toHaveLength(65536);
        expect(() => clientSystemInstructions({"ahpd.clientSystemInstructions": "é".repeat(65537)})).toThrow();
    });

    it.each([null, 1, {}, "", "  "])("rejects explicit invalid input without copying it into errors: %j", value => {
        expect(() => clientSystemInstructions({"ahpd.clientSystemInstructions": value})).toThrow("Client system instructions must be");
    });

    it("leaves clients that did not request the extension unchanged", () => {
        expect(clientSystemInstructions(undefined)).toBeUndefined();
        expect(clientSystemInstructions({})).toBeUndefined();
        expect(supportsClientSystemInstructions(undefined)).toBe(false);
        expect(supportsClientSystemInstructions({_meta: {"ahpd.clientSystemInstructions": {version: 2}}})).toBe(false);
        expect(supportsClientSystemInstructions({_meta: {"ahpd.clientSystemInstructions": {version: 1}}})).toBe(true);
    });
});
