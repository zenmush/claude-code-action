#!/usr/bin/env bun
// Revert the test commit we just made

const GITHUB_API_URL = "https://api.github.com";

async function revertTestCommit(token: string) {
  const owner = "anthropics";
  const repo = "anthropic";
  const branch = "monty/fixing-pipeline-runner";
  
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };

  console.log(`\n=== Reverting test commit ===`);
  console.log(`Repository: ${owner}/${repo}`);
  console.log(`Branch: ${branch}\n`);

  try {
    // Get current branch state
    console.log("Getting current branch reference...");
    const refUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/refs/heads/${branch}`;
    const refResponse = await fetch(refUrl, { headers });
    
    if (!refResponse.ok) {
      console.error(`Failed to get branch: ${refResponse.status}`);
      return;
    }

    const refData = await refResponse.json();
    const currentSha = refData.object.sha;
    console.log(`Current branch SHA: ${currentSha}`);

    // Get the current commit to find its parent
    console.log("\nGetting current commit details...");
    const commitResponse = await fetch(
      `${GITHUB_API_URL}/repos/${owner}/${repo}/git/commits/${currentSha}`,
      { headers }
    );
    
    if (!commitResponse.ok) {
      console.error(`Failed to get commit: ${commitResponse.status}`);
      return;
    }

    const commitData = await commitResponse.json();
    console.log(`Current commit message: "${commitData.message}"`);
    
    if (!commitData.message.includes("Debug: Test commit to reproduce 500 error")) {
      console.log("⚠️  Current commit doesn't look like our test commit");
      console.log("Are you sure you want to revert this?");
      console.log("Current message:", commitData.message);
      return;
    }

    if (commitData.parents.length === 0) {
      console.error("Cannot revert: this appears to be the initial commit");
      return;
    }

    const parentSha = commitData.parents[0].sha;
    console.log(`Parent SHA: ${parentSha}`);

    // Reset the branch to the parent commit
    console.log("\nReverting branch to parent commit...");
    const updateRefResponse = await fetch(refUrl, {
      method: "PATCH",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sha: parentSha,
        force: true, // Force is needed for this kind of reset
      }),
    });

    if (!updateRefResponse.ok) {
      console.error(`Failed to revert: ${updateRefResponse.status}`);
      const error = await updateRefResponse.text();
      console.error(error);
      return;
    }

    console.log("✅ Successfully reverted test commit!");
    console.log(`Branch ${branch} is now back to SHA: ${parentSha}`);
    
    // Verify the revert
    console.log("\nVerifying revert...");
    const verifyResponse = await fetch(refUrl, { headers });
    const verifyData = await verifyResponse.json();
    
    if (verifyData.object.sha === parentSha) {
      console.log("✅ Revert confirmed");
    } else {
      console.log("⚠️  Unexpected SHA after revert:", verifyData.object.sha);
    }

  } catch (error) {
    console.error("Error:", error);
  }
}

const token = process.argv[2];
if (!token) {
  console.log("Usage: bun revert-test-commit.ts <github-pat>");
  process.exit(1);
}

revertTestCommit(token);