#!/usr/bin/env bun
// Check the status of PR #105775

const GITHUB_API_URL = "https://api.github.com";

async function checkPRStatus(token: string) {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };

  try {
    // Check PR details
    console.log("Checking PR #105775...\n");
    const prResponse = await fetch(
      `${GITHUB_API_URL}/repos/anthropics/anthropic/pulls/105775`,
      { headers }
    );
    
    console.log(`PR Status: ${prResponse.status}`);
    
    if (!prResponse.ok) {
      if (prResponse.status === 404) {
        console.log("PR not found - it might be in a private repo or deleted");
      }
      const error = await prResponse.text();
      console.error(error);
      return;
    }
    
    const prData = await prResponse.json();
    console.log(`Title: ${prData.title}`);
    console.log(`State: ${prData.state}`);
    console.log(`Branch: ${prData.head.ref}`);
    console.log(`Base: ${prData.base.ref}`);
    console.log(`Created: ${prData.created_at}`);
    console.log(`Updated: ${prData.updated_at}`);
    
    // Check if branch still exists
    console.log(`\nChecking if branch '${prData.head.ref}' still exists...`);
    const branchResponse = await fetch(
      `${GITHUB_API_URL}/repos/anthropics/anthropic/git/refs/heads/${prData.head.ref}`,
      { headers }
    );
    
    if (branchResponse.ok) {
      const branchData = await branchResponse.json();
      console.log(`✓ Branch exists with SHA: ${branchData.object.sha}`);
      console.log(`  PR head SHA: ${prData.head.sha}`);
      if (branchData.object.sha !== prData.head.sha) {
        console.log(`  ⚠️  Branch has been updated since PR was created`);
      }
    } else {
      console.log(`✗ Branch does not exist (${branchResponse.status})`);
    }
    
    // Get recent comments
    console.log(`\nFetching recent comments...`);
    const commentsResponse = await fetch(
      `${GITHUB_API_URL}/repos/anthropics/anthropic/issues/105775/comments?per_page=5&sort=created&direction=desc`,
      { headers }
    );
    
    if (commentsResponse.ok) {
      const comments = await commentsResponse.json();
      console.log(`Found ${comments.length} recent comments:`);
      
      comments.reverse().forEach((comment: any, index: number) => {
        console.log(`\nComment ${index + 1}:`);
        console.log(`  Author: ${comment.user.login}`);
        console.log(`  Created: ${comment.created_at}`);
        console.log(`  Body preview: ${comment.body.substring(0, 100)}...`);
        
        // Check if it's a claude-code-action comment
        if (comment.body.includes("claude") || comment.user.login.includes("bot")) {
          console.log(`  → Appears to be a Claude-related comment`);
        }
      });
    }
    
  } catch (error) {
    console.error("Error:", error);
  }
}

const token = process.argv[2];
if (!token) {
  console.log("Usage: bun check-pr-status.ts <github-pat>");
  process.exit(1);
}

checkPRStatus(token);