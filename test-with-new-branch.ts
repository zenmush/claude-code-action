#!/usr/bin/env bun
// Test script that creates a new branch to test the commit_files flow
// Run with: bun test-with-new-branch.ts <github-pat> <owner> <repo>

const GITHUB_API_URL = "https://api.github.com";

async function testCommitFilesWithNewBranch(token: string, owner: string, repo: string) {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };

  // Create a unique branch name for testing
  const timestamp = Date.now();
  const testBranch = `claude-debug-500-test-${timestamp}`;

  console.log(`\n=== Testing commit_files flow ===`);
  console.log(`Repository: ${owner}/${repo}`);
  console.log(`Test branch: ${testBranch}\n`);

  try {
    // First, get the default branch to branch from
    console.log("Getting repository info...");
    const repoResponse = await fetch(
      `${GITHUB_API_URL}/repos/${owner}/${repo}`,
      { headers }
    );
    
    if (!repoResponse.ok) {
      console.error(`Cannot access repository: ${repoResponse.status}`);
      const error = await repoResponse.text();
      console.error(error);
      return;
    }
    
    const repoData = await repoResponse.json();
    const defaultBranch = repoData.default_branch;
    console.log(`✓ Default branch: ${defaultBranch}`);

    // Get the SHA of the default branch
    console.log(`\nGetting ${defaultBranch} branch SHA...`);
    const defaultBranchResponse = await fetch(
      `${GITHUB_API_URL}/repos/${owner}/${repo}/git/refs/heads/${defaultBranch}`,
      { headers }
    );
    
    if (!defaultBranchResponse.ok) {
      console.error(`Cannot get default branch: ${defaultBranchResponse.status}`);
      return;
    }
    
    const defaultBranchData = await defaultBranchResponse.json();
    const baseSha = defaultBranchData.object.sha;
    console.log(`✓ Base SHA: ${baseSha}`);

    // Create a new branch
    console.log(`\nCreating test branch: ${testBranch}...`);
    const createBranchResponse = await fetch(
      `${GITHUB_API_URL}/repos/${owner}/${repo}/git/refs`,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ref: `refs/heads/${testBranch}`,
          sha: baseSha,
        }),
      }
    );
    
    if (!createBranchResponse.ok) {
      console.error(`Failed to create branch: ${createBranchResponse.status}`);
      const error = await createBranchResponse.text();
      console.error(error);
      return;
    }
    
    console.log(`✓ Created test branch: ${testBranch}`);
    
    // Now replicate the commit_files flow
    console.log("\n--- Starting commit_files flow ---");
    
    // Step 1: Get the branch reference (should be same as baseSha)
    console.log("\nStep 1: Getting branch reference...");
    const refUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/refs/heads/${testBranch}`;
    const refResponse = await fetch(refUrl, { headers });
    
    if (!refResponse.ok) {
      console.error(`Failed: ${refResponse.status}`);
      return;
    }

    const refData = await refResponse.json();
    console.log(`✓ Branch SHA: ${refData.object.sha}`);

    // Step 2: Get the base commit
    console.log("\nStep 2: Getting base commit...");
    const commitUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/commits/${baseSha}`;
    const commitResponse = await fetch(commitUrl, { headers });
    
    if (!commitResponse.ok) {
      console.error(`Failed: ${commitResponse.status}`);
      return;
    }

    const commitData = await commitResponse.json();
    const baseTreeSha = commitData.tree.sha;
    console.log(`✓ Base tree SHA: ${baseTreeSha}`);

    // Step 3: Create a new tree
    console.log("\nStep 3: Creating new tree...");
    const treeUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/trees`;
    
    const testFileContent = `# Test file for debugging 500 error
# Created at: ${new Date().toISOString()}
# This simulates the commit_files operation from claude-code-action

def test_function():
    # This simulates fixing a code issue
    result = "Fixed code"
    return result
`;

    const treeBody = {
      base_tree: baseTreeSha,
      tree: [{
        path: "test-debug-500.py",
        mode: "100644",
        type: "blob",
        content: testFileContent,
      }],
    };

    const treeResponse = await fetch(treeUrl, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(treeBody),
    });
    
    if (!treeResponse.ok) {
      console.error(`Failed to create tree: ${treeResponse.status}`);
      const error = await treeResponse.text();
      console.error(error);
      return;
    }

    const treeData = await treeResponse.json();
    console.log(`✓ Tree SHA: ${treeData.sha}`);

    // Step 4: Create commit
    console.log("\nStep 4: Creating commit...");
    const newCommitUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/commits`;
    const commitBody = {
      message: "Test: Debugging 500 error in commit_files",
      tree: treeData.sha,
      parents: [baseSha],
    };

    const newCommitResponse = await fetch(newCommitUrl, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commitBody),
    });

    if (!newCommitResponse.ok) {
      console.error(`Failed to create commit: ${newCommitResponse.status}`);
      const error = await newCommitResponse.text();
      console.error(error);
      return;
    }

    const newCommitData = await newCommitResponse.json();
    console.log(`✓ Commit SHA: ${newCommitData.sha}`);

    // Step 5: Update reference (this is where the 500 error happens)
    console.log("\nStep 5: Updating branch reference (the critical step)...");
    const updateRefUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/refs/heads/${testBranch}`;
    const updateBody = {
      sha: newCommitData.sha,
      force: false,
    };

    console.log(`URL: PATCH ${updateRefUrl}`);
    console.log(`Body: ${JSON.stringify(updateBody)}`);
    
    const startTime = Date.now();
    const updateRefResponse = await fetch(updateRefUrl, {
      method: "PATCH",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updateBody),
    });
    const duration = Date.now() - startTime;

    console.log(`\nStatus: ${updateRefResponse.status} (took ${duration}ms)`);
    console.log(`Headers:`, {
      'x-ratelimit-remaining': updateRefResponse.headers.get('x-ratelimit-remaining'),
      'x-github-request-id': updateRefResponse.headers.get('x-github-request-id'),
    });

    if (!updateRefResponse.ok) {
      console.error(`\n✗ FAILED: ${updateRefResponse.status}`);
      const errorText = await updateRefResponse.text();
      console.error(`Error body: "${errorText}"`);
      
      if (updateRefResponse.status === 500) {
        console.error(`\n🔍 500 ERROR REPRODUCED!`);
        console.error(`This confirms the issue exists with PAT as well.`);
        console.error(`GitHub Request ID: ${updateRefResponse.headers.get('x-github-request-id')}`);
      }
    } else {
      console.log(`\n✓ SUCCESS: Branch updated!`);
      console.log(`The 500 error might be specific to certain conditions.`);
      
      // Cleanup: delete the test branch
      console.log(`\nCleaning up test branch...`);
      const deleteResponse = await fetch(
        `${GITHUB_API_URL}/repos/${owner}/${repo}/git/refs/heads/${testBranch}`,
        {
          method: "DELETE",
          headers,
        }
      );
      
      if (deleteResponse.ok) {
        console.log(`✓ Test branch deleted`);
      }
    }

  } catch (error) {
    console.error(`\nUnexpected error:`, error);
  }
}

// Main execution
const [token, owner, repo] = process.argv.slice(2);

if (!token || !owner || !repo) {
  console.log("Usage: bun test-with-new-branch.ts <github-pat> <owner> <repo>");
  console.log("");
  console.log("Examples:");
  console.log("  bun test-with-new-branch.ts ghp_xxx myorg myrepo");
  console.log("  bun test-with-new-branch.ts ghp_xxx anthropics anthropic");
  console.log("");
  console.log("This creates a test branch and replicates the commit_files flow.");
  process.exit(1);
}

console.log("Starting test with new branch...");
testCommitFilesWithNewBranch(token, owner, repo);