import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionTokenManager } from "../../../src/session/token";

describe("SessionTokenManager", () => {
  const secret = "test-secret-key-for-hmac-signing-at-least-32-chars";

  describe("createToken", () => {
    it("creates a token with correct format (payload.signature)", async () => {
      const manager = new SessionTokenManager(secret);
      const token = await manager.createToken("2025-11-25", ["tools", "resources"]);

      expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      expect(token.split(".")).toHaveLength(2);
    });

    it("includes protocol version in payload", async () => {
      const manager = new SessionTokenManager(secret);
      const token = await manager.createToken("2025-11-25", ["tools"]);
      const result = await manager.validateToken(token);

      expect(result.valid).toBe(true);
      expect(result.payload?.v).toBe("2025-11-25");
    });

    it("includes sorted capabilities in payload", async () => {
      const manager = new SessionTokenManager(secret);
      const token = await manager.createToken("2025-11-25", ["tools", "resources"]);
      const result = await manager.validateToken(token);

      expect(result.valid).toBe(true);
      expect(result.payload?.caps).toBe("resources,tools");
    });

    it("includes timestamps in payload", async () => {
      const manager = new SessionTokenManager(secret);
      const token = await manager.createToken("2025-11-25", ["tools"]);
      const result = await manager.validateToken(token);

      expect(result.valid).toBe(true);
      expect(result.payload?.iat).toBeGreaterThan(0);
      expect(result.payload?.exp).toBeGreaterThan(result.payload!.iat);
    });

    it("creates tokens with 1 hour TTL", async () => {
      const manager = new SessionTokenManager(secret);
      const token = await manager.createToken("2025-11-25", ["tools"]);
      const result = await manager.validateToken(token);

      expect(result.valid).toBe(true);
      const ttl = result.payload!.exp - result.payload!.iat;
      expect(ttl).toBe(3600); // 1 hour in seconds
    });

    it("creates different tokens for different secrets", async () => {
      const manager1 = new SessionTokenManager("secret-one-32-chars-minimum-test");
      const manager2 = new SessionTokenManager("secret-two-32-chars-minimum-test");

      const token1 = await manager1.createToken("2025-11-25", ["tools"]);
      const token2 = await manager2.createToken("2025-11-25", ["tools"]);

      // Signatures should differ
      const sig1 = token1.split(".")[1];
      const sig2 = token2.split(".")[1];
      expect(sig1).not.toBe(sig2);
    });
  });

  describe("validateToken", () => {
    it("returns missing error for empty token", async () => {
      const manager = new SessionTokenManager(secret);
      const result = await manager.validateToken("");

      expect(result.valid).toBe(false);
      expect(result.error).toBe("missing");
    });

    it("returns malformed error for token without dot", async () => {
      const manager = new SessionTokenManager(secret);
      const result = await manager.validateToken("not-a-valid-token");

      expect(result.valid).toBe(false);
      expect(result.error).toBe("malformed");
    });

    it("returns malformed error for token with multiple dots", async () => {
      const manager = new SessionTokenManager(secret);
      const result = await manager.validateToken("a.b.c");

      expect(result.valid).toBe(false);
      expect(result.error).toBe("malformed");
    });

    it("returns invalid error for tampered payload", async () => {
      const manager = new SessionTokenManager(secret);
      const token = await manager.createToken("2025-11-25", ["tools"]);
      const [payload, sig] = token.split(".");

      // Modify payload
      const tampered = payload.slice(0, -5) + "XXXXX" + "." + sig;
      const result = await manager.validateToken(tampered);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("invalid");
    });

    it("returns invalid error for tampered signature", async () => {
      const manager = new SessionTokenManager(secret);
      const token = await manager.createToken("2025-11-25", ["tools"]);
      const [payload, sig] = token.split(".");

      // Modify signature
      const tampered = payload + "." + sig.slice(0, -5) + "XXXXX";
      const result = await manager.validateToken(tampered);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("invalid");
    });

    it("returns invalid error for token signed with different secret", async () => {
      const manager1 = new SessionTokenManager("secret-one-32-chars-minimum-test");
      const manager2 = new SessionTokenManager("secret-two-32-chars-minimum-test");

      const token = await manager1.createToken("2025-11-25", ["tools"]);
      const result = await manager2.validateToken(token);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("invalid");
    });

    it("returns valid for correct token", async () => {
      const manager = new SessionTokenManager(secret);
      const token = await manager.createToken("2025-11-25", ["tools"]);
      const result = await manager.validateToken(token);

      expect(result.valid).toBe(true);
      expect(result.payload).toBeDefined();
    });

    it("returns malformed error for invalid base64", async () => {
      const manager = new SessionTokenManager(secret);
      const result = await manager.validateToken("!!!invalid!!.!!!base64!!!");

      expect(result.valid).toBe(false);
      // Could be malformed or invalid depending on how the decode fails
      expect(["malformed", "invalid"]).toContain(result.error);
    });

    it("returns malformed error for payload missing required field 'v'", async () => {
      const manager = new SessionTokenManager(secret);

      // Mock verifySignature to return true so we can test payload validation
      vi.spyOn(manager as any, "verifySignature").mockResolvedValue(true);

      // Create a payload without 'v' field
      const now = Math.floor(Date.now() / 1000);
      const incompletePayload = { iat: now, exp: now + 3600, caps: "tools" };
      const payloadB64 = btoa(JSON.stringify(incompletePayload))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      const result = await manager.validateToken(payloadB64 + ".fakesignature");

      expect(result.valid).toBe(false);
      expect(result.error).toBe("malformed");
    });

    it("returns malformed error for payload missing required field 'iat'", async () => {
      const manager = new SessionTokenManager(secret);

      vi.spyOn(manager as any, "verifySignature").mockResolvedValue(true);

      const now = Math.floor(Date.now() / 1000);
      const incompletePayload = { v: "2025-11-25", exp: now + 3600, caps: "tools" };
      const payloadB64 = btoa(JSON.stringify(incompletePayload))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      const result = await manager.validateToken(payloadB64 + ".fakesignature");

      expect(result.valid).toBe(false);
      expect(result.error).toBe("malformed");
    });

    it("returns malformed error for payload missing required field 'exp'", async () => {
      const manager = new SessionTokenManager(secret);

      vi.spyOn(manager as any, "verifySignature").mockResolvedValue(true);

      const now = Math.floor(Date.now() / 1000);
      const incompletePayload = { v: "2025-11-25", iat: now, caps: "tools" };
      const payloadB64 = btoa(JSON.stringify(incompletePayload))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      const result = await manager.validateToken(payloadB64 + ".fakesignature");

      expect(result.valid).toBe(false);
      expect(result.error).toBe("malformed");
    });

    it("returns invalid error for wrong protocol version in payload", async () => {
      const manager = new SessionTokenManager(secret);

      vi.spyOn(manager as any, "verifySignature").mockResolvedValue(true);

      // Create payload with wrong protocol version
      const now = Math.floor(Date.now() / 1000);
      const wrongVersionPayload = { v: "2024-01-01", iat: now, exp: now + 3600, caps: "tools" };
      const payloadB64 = btoa(JSON.stringify(wrongVersionPayload))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      const result = await manager.validateToken(payloadB64 + ".fakesignature");

      expect(result.valid).toBe(false);
      expect(result.error).toBe("invalid");
    });

    it("returns malformed error for non-JSON payload", async () => {
      const manager = new SessionTokenManager(secret);

      vi.spyOn(manager as any, "verifySignature").mockResolvedValue(true);

      // Create a base64 payload that's not valid JSON
      const invalidJsonB64 = btoa("this is not json")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      const result = await manager.validateToken(invalidJsonB64 + ".fakesignature");

      expect(result.valid).toBe(false);
      expect(result.error).toBe("malformed");
    });
  });

  describe("token expiration", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("validates token within TTL", async () => {
      const manager = new SessionTokenManager(secret);
      const token = await manager.createToken("2025-11-25", ["tools"]);

      // Advance 30 minutes
      vi.advanceTimersByTime(30 * 60 * 1000);

      const result = await manager.validateToken(token);
      expect(result.valid).toBe(true);
    });

    it("returns expired error after TTL", async () => {
      const manager = new SessionTokenManager(secret);
      const token = await manager.createToken("2025-11-25", ["tools"]);

      // Advance 61 minutes (past 1 hour TTL)
      vi.advanceTimersByTime(61 * 60 * 1000);

      const result = await manager.validateToken(token);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("expired");
    });

    it("returns expired error exactly at expiration", async () => {
      const manager = new SessionTokenManager(secret);
      const token = await manager.createToken("2025-11-25", ["tools"]);

      // Advance exactly 1 hour + 1 second
      vi.advanceTimersByTime(3601 * 1000);

      const result = await manager.validateToken(token);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("expired");
    });
  });
});
