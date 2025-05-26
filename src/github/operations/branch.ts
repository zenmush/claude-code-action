#!/usr/bin/env bun

/**
 * Setup the appropriate branch based on the event type:
 * - For PRs: Checkout the PR branch
 * - For Issues: Create a new branch
 */

import { $ } from "bun";
import * as core from "@actions/core";
import type { ParsedGitHubContext } from "../context";
import type { GitHubPullRequest } from "../types";
import type { Octokits } from "../api/client";
import type { FetchDataResult } from "../data/fetcher";

export type BranchInfo = {
  defaultBranch: string;
  claudeBranch?: string;
  currentBranch: string;
};

export async function setupBranch(
  octokits: Octokits,
  githubData: FetchDataResult,
  context: ParsedGitHubContext,
): Promise<BranchInfo> {
  const { owner, repo } = context.repository;
  const entityNumber = context.entityNumber;
  const isPR = context.isPR;

  // Get the default branch first
  const repoResponse = await octokits.rest.repos.get({
    owner,
    repo,
  });
  const defaultBranch = repoResponse.data.default_branch;

  if (isPR) {
    const prData = githubData.contextData as GitHubPullRequest;
    const prState = prData.state;

    // Check if PR is closed or merged
    if (prState === "CLOSED" || prState === "MERGED") {
      console.log(
        `PR #${entityNumber} is ${prState}, creating new branch from default...`,
      );
      // Fall through to create a new branch like we do for issues
    } else {
      // Handle open PR: Checkout the PR branch
      console.log("This is an open PR, checking out PR branch...");

      const branchName = prData.headRefName;

      // Execute git commands to checkout PR branch (shallow fetch for performance)
      await $`git fetch origin --depth=1 ${branchName}`;
      await $`git checkout ${branchName}`;

      console.log(`Successfully checked out PR branch for PR #${entityNumber}`);

      // For open PRs, return branch info
      return {
        defaultBranch,
        currentBranch: branchName,
      };
    }
  }

  // Creating a new branch for either an issue or closed/merged PR
  const entityType = isPR ? "pr" : "issue";
  console.log(`Creating new branch for ${entityType} #${entityNumber}...`);

  const timestamp = new Date()
    .toISOString()
    .replace(/[:-]/g, "")
    .replace(/\.\d{3}Z/, "")
    .split("T")
    .join("_");

  const newBranch = `claude/${entityType}-${entityNumber}-${timestamp}`;

  try {
    // Get the SHA of the default branch
    const defaultBranchRef = await octokits.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${defaultBranch}`,
    });

    const currentSHA = defaultBranchRef.data.object.sha;

    console.log(`Current SHA: ${currentSHA}`);

    // Create branch using GitHub API
    await octokits.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${newBranch}`,
      sha: currentSHA,
    });

    // Checkout the new branch (shallow fetch for performance)
    await $`git fetch origin --depth=1 ${newBranch}`;
    await $`git checkout ${newBranch}`;

    console.log(
      `Successfully created and checked out new branch: ${newBranch}`,
    );

    // Set outputs for GitHub Actions
    core.setOutput("CLAUDE_BRANCH", newBranch);
    core.setOutput("DEFAULT_BRANCH", defaultBranch);
    return {
      defaultBranch,
      claudeBranch: newBranch,
      currentBranch: newBranch,
    };
  } catch (error) {
    console.error("Error creating branch:", error);
    process.exit(1);
  }
}
