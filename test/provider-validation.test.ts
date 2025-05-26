import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  validateProviderSelection,
  validateMaxPlanRunner,
  isUsingMaxPlan,
} from "../src/github/validation/provider";

describe("Provider Validation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("validateProviderSelection", () => {
    it("should pass when no provider is set (defaults to API key)", () => {
      expect(() => validateProviderSelection()).not.toThrow();
    });

    it("should pass when only Max plan is enabled", () => {
      process.env.USE_MAX_PLAN = "true";
      expect(() => validateProviderSelection()).not.toThrow();
    });

    it("should pass when only Bedrock is enabled", () => {
      process.env.USE_BEDROCK = "true";
      expect(() => validateProviderSelection()).not.toThrow();
    });

    it("should pass when only Vertex is enabled", () => {
      process.env.USE_VERTEX = "true";
      expect(() => validateProviderSelection()).not.toThrow();
    });

    it("should fail when Max plan and Bedrock are both enabled", () => {
      process.env.USE_MAX_PLAN = "true";
      process.env.USE_BEDROCK = "true";
      expect(() => validateProviderSelection()).toThrow(
        "Cannot use multiple authentication methods simultaneously",
      );
    });

    it("should fail when Max plan and Vertex are both enabled", () => {
      process.env.USE_MAX_PLAN = "true";
      process.env.USE_VERTEX = "true";
      expect(() => validateProviderSelection()).toThrow(
        "Cannot use multiple authentication methods simultaneously",
      );
    });

    it("should fail when all three providers are enabled", () => {
      process.env.USE_MAX_PLAN = "true";
      process.env.USE_BEDROCK = "true";
      process.env.USE_VERTEX = "true";
      expect(() => validateProviderSelection()).toThrow(
        "Cannot use multiple authentication methods simultaneously",
      );
    });
  });

  describe("isUsingMaxPlan", () => {
    it("should return false when USE_MAX_PLAN is not set", () => {
      expect(isUsingMaxPlan()).toBe(false);
    });

    it("should return false when USE_MAX_PLAN is 'false'", () => {
      process.env.USE_MAX_PLAN = "false";
      expect(isUsingMaxPlan()).toBe(false);
    });

    it("should return true when USE_MAX_PLAN is 'true'", () => {
      process.env.USE_MAX_PLAN = "true";
      expect(isUsingMaxPlan()).toBe(true);
    });
  });

  describe("validateMaxPlanRunner", () => {
    it("should pass when not using Max plan", () => {
      expect(() => validateMaxPlanRunner()).not.toThrow();
    });

    it("should pass when using Max plan on self-hosted runner", () => {
      process.env.USE_MAX_PLAN = "true";
      // No RUNNER_ENVIRONMENT set (typical for self-hosted)
      expect(() => validateMaxPlanRunner()).not.toThrow();
    });

    it("should pass when using Max plan on explicitly self-hosted runner", () => {
      process.env.USE_MAX_PLAN = "true";
      process.env.RUNNER_ENVIRONMENT = "self-hosted";
      expect(() => validateMaxPlanRunner()).not.toThrow();
    });

    it("should fail when using Max plan on GitHub-hosted runner", () => {
      process.env.USE_MAX_PLAN = "true";
      process.env.RUNNER_ENVIRONMENT = "github-hosted";
      expect(() => validateMaxPlanRunner()).toThrow(
        "Max plan authentication requires a self-hosted runner",
      );
    });
  });
});
