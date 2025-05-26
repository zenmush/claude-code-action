#!/usr/bin/env bun

/**
 * Prepare the Claude action by checking trigger conditions, verifying human actor,
 * and creating the initial tracking comment
 */

import * as core from "@actions/core";
import { setupGitHubToken } from "../github/token";
import { checkTriggerAction } from "../github/validation/trigger";
import { checkHumanActor } from "../github/validation/actor";
import { checkWritePermissions } from "../github/validation/permissions";
import {
  validateProviderSelection,
  validateMaxPlanRunner,
  isUsingMaxPlan,
} from "../github/validation/provider";
import { createInitialComment } from "../github/operations/comments/create-initial";
import { setupBranch } from "../github/operations/branch";
import { updateTrackingComment } from "../github/operations/comments/update-with-branch";
import { prepareMcpConfig } from "../mcp/install-mcp-server";
import { createPrompt } from "../create-prompt";
import { createOctokit } from "../github/api/client";
import { fetchGitHubData } from "../github/data/fetcher";
import { parseGitHubContext } from "../github/context";

async function run() {
  try {
    // Step 1: Validate provider selection (only one auth method allowed)
    validateProviderSelection();
    validateMaxPlanRunner();

    // Step 2: Setup GitHub token (skip exchange for Max plan)
    let githubToken: string;
    if (isUsingMaxPlan()) {
      // Max plan uses the provided GitHub token directly
      githubToken =
        process.env.OVERRIDE_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "";
      if (!githubToken) {
        throw new Error(
          "GitHub token is required when using Max plan authentication",
        );
      }
    } else {
      // Other providers use token exchange
      githubToken = await setupGitHubToken();
    }
    const octokit = createOctokit(githubToken);

    // Step 3: Parse GitHub context (once for all operations)
    const context = parseGitHubContext();

    // Step 4: Check write permissions
    const hasWritePermissions = await checkWritePermissions(
      octokit.rest,
      context,
    );
    if (!hasWritePermissions) {
      throw new Error(
        "Actor does not have write permissions to the repository",
      );
    }

    // Step 5: Check trigger conditions
    const containsTrigger = await checkTriggerAction(context);

    if (!containsTrigger) {
      console.log("No trigger found, skipping remaining steps");
      return;
    }

    // Step 6: Check if actor is human
    await checkHumanActor(octokit.rest, context);

    // Step 7: Create initial tracking comment
    const commentId = await createInitialComment(octokit.rest, context);

    // Step 8: Fetch GitHub data (once for both branch setup and prompt creation)
    const githubData = await fetchGitHubData({
      octokits: octokit,
      repository: `${context.repository.owner}/${context.repository.repo}`,
      prNumber: context.entityNumber.toString(),
      isPR: context.isPR,
    });

    // Step 9: Setup branch
    const branchInfo = await setupBranch(octokit, githubData, context);

    // Step 10: Update initial comment with branch link (only for issues that created a new branch)
    if (branchInfo.claudeBranch) {
      await updateTrackingComment(
        octokit,
        context,
        commentId,
        branchInfo.claudeBranch,
      );
    }

    // Step 11: Create prompt file
    await createPrompt(
      commentId,
      branchInfo.defaultBranch,
      branchInfo.claudeBranch,
      githubData,
      context,
    );

    // Step 12: Get MCP configuration
    const mcpConfig = await prepareMcpConfig(
      githubToken,
      context.repository.owner,
      context.repository.repo,
      branchInfo.currentBranch,
    );
    core.setOutput("mcp_config", mcpConfig);
  } catch (error) {
    core.setFailed(`Prepare step failed with error: ${error}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  run();
}
