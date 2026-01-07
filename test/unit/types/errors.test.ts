import { describe, it, expect } from "vitest";
import {
  ToolNotFoundError,
  ToolExecutionError,
  ResourceNotFoundError
} from "../../../src/types";

describe("Custom Error Classes", () => {
  describe("ToolNotFoundError", () => {
    it("creates error with tool name in message", () => {
      const error = new ToolNotFoundError("unknown_tool");
      expect(error.message).toBe("Tool not found: unknown_tool");
      expect(error.name).toBe("ToolNotFoundError");
    });

    it("is an instance of Error", () => {
      const error = new ToolNotFoundError("test_tool");
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ToolNotFoundError);
    });

    it("has correct stack trace", () => {
      const error = new ToolNotFoundError("test_tool");
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain("ToolNotFoundError");
    });
  });

  describe("ToolExecutionError", () => {
    it("creates error with message only", () => {
      const error = new ToolExecutionError("Something failed");
      expect(error.message).toBe("Something failed");
      expect(error.name).toBe("ToolExecutionError");
      expect(error.statusCode).toBeUndefined();
      expect(error.errorCode).toBeUndefined();
    });

    it("creates error with status code", () => {
      const error = new ToolExecutionError("Not Found", 404);
      expect(error.message).toBe("Not Found");
      expect(error.statusCode).toBe(404);
      expect(error.errorCode).toBeUndefined();
    });

    it("creates error with status code and error code", () => {
      const error = new ToolExecutionError("API Error", 404, "NOT_FOUND");
      expect(error.message).toBe("API Error");
      expect(error.statusCode).toBe(404);
      expect(error.errorCode).toBe("NOT_FOUND");
    });

    it("is an instance of Error", () => {
      const error = new ToolExecutionError("test");
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ToolExecutionError);
    });

    it("preserves all HTTP status codes", () => {
      const badRequest = new ToolExecutionError("Bad Request", 400, "INVALID_PARAMS");
      const unauthorized = new ToolExecutionError("Unauthorized", 401, "AUTH_FAILED");
      const forbidden = new ToolExecutionError("Forbidden", 403, "ACCESS_DENIED");
      const serverError = new ToolExecutionError("Server Error", 500, "INTERNAL_ERROR");

      expect(badRequest.statusCode).toBe(400);
      expect(unauthorized.statusCode).toBe(401);
      expect(forbidden.statusCode).toBe(403);
      expect(serverError.statusCode).toBe(500);
    });
  });

  describe("ResourceNotFoundError", () => {
    it("creates error with URI in message", () => {
      const error = new ResourceNotFoundError("happyfox://unknown");
      expect(error.message).toBe("Resource not found: happyfox://unknown");
      expect(error.name).toBe("ResourceNotFoundError");
    });

    it("is an instance of Error", () => {
      const error = new ResourceNotFoundError("happyfox://test");
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ResourceNotFoundError);
    });

    it("handles various URI formats", () => {
      const error1 = new ResourceNotFoundError("happyfox://categories");
      const error2 = new ResourceNotFoundError("happyfox://ticket-custom-fields");
      const error3 = new ResourceNotFoundError("invalid-uri");

      expect(error1.message).toBe("Resource not found: happyfox://categories");
      expect(error2.message).toBe("Resource not found: happyfox://ticket-custom-fields");
      expect(error3.message).toBe("Resource not found: invalid-uri");
    });
  });
});
