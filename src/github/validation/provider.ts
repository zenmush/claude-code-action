/**
 * Validates that only one authentication provider is selected
 */
export function validateProviderSelection(): void {
  const useBedrock = process.env.USE_BEDROCK === "true";
  const useVertex = process.env.USE_VERTEX === "true";
  const useMaxPlan = process.env.USE_MAX_PLAN === "true";

  const providersCount = [useBedrock, useVertex, useMaxPlan].filter(
    Boolean,
  ).length;

  if (providersCount > 1) {
    throw new Error(
      "Cannot use multiple authentication methods simultaneously. Please set only one of: use_bedrock, use_vertex, or use_max_plan.",
    );
  }

  // Log which provider is being used
  if (useMaxPlan) {
    console.log(
      "Using Max plan authentication. Ensure Claude Code is pre-authenticated on this self-hosted runner.",
    );
  } else if (useBedrock) {
    console.log("Using AWS Bedrock authentication.");
  } else if (useVertex) {
    console.log("Using Google Vertex AI authentication.");
  } else {
    console.log("Using direct Anthropic API authentication.");
  }
}

/**
 * Checks if Max plan authentication is being used
 */
export function isUsingMaxPlan(): boolean {
  return process.env.USE_MAX_PLAN === "true";
}

/**
 * Validates that the runner is self-hosted when using Max plan
 */
export function validateMaxPlanRunner(): void {
  if (!isUsingMaxPlan()) {
    return;
  }

  // Check if running on GitHub-hosted runner (they have RUNNER_ENVIRONMENT set to "github-hosted")
  const runnerEnvironment = process.env.RUNNER_ENVIRONMENT;
  if (runnerEnvironment === "github-hosted") {
    throw new Error(
      "Max plan authentication requires a self-hosted runner. GitHub-hosted runners do not have persistent authentication state. " +
        "Please set up a self-hosted runner with pre-authenticated Claude Code.",
    );
  }

  console.log("Running on self-hosted runner with Max plan authentication.");
}
