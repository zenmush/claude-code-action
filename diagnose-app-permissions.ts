#!/usr/bin/env bun
// Diagnose why GitHub App permissions are inconsistent

const GITHUB_API_URL = "https://api.github.com";

async function diagnosePermissions(token: string, owner: string, repo: string) {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };

  console.log(`\n=== Diagnosing GitHub App Permission Issues ===`);
  console.log(`Repository: ${owner}/${repo}\n`);

  try {
    // 1. Check what type of token we have
    console.log("1. Token Analysis:");
    const authHeader = headers.Authorization;
    if (authHeader.includes('ghs_')) {
      console.log("✓ GitHub App installation token detected");
    } else if (authHeader.includes('ghp_')) {
      console.log("✓ Personal Access Token detected");
    } else {
      console.log("? Unknown token type");
    }

    // 2. Check rate limit headers (different for apps vs users)
    console.log("\n2. Rate Limit Analysis:");
    const rateLimitResponse = await fetch(`${GITHUB_API_URL}/rate_limit`, { headers });
    if (rateLimitResponse.ok) {
      const rateData = await rateLimitResponse.json();
      console.log(`  Core limit: ${rateData.rate.remaining}/${rateData.rate.limit}`);
      if (rateData.rate.limit > 5000) {
        console.log("  → Higher limit suggests GitHub App token");
      } else {
        console.log("  → Standard limit suggests user token");
      }
    }

    // 3. Test different API endpoints to find permission boundaries
    console.log("\n3. Testing API Endpoints:");
    
    // Test regular content API
    console.log("\n  a) Content API (high-level):");
    const contentResponse = await fetch(
      `${GITHUB_API_URL}/repos/${owner}/${repo}/contents/README.md`,
      { headers }
    );
    console.log(`     GET contents: ${contentResponse.status} ${contentResponse.ok ? '✓' : '✗'}`);

    // Test git database read
    console.log("\n  b) Git Database API (read):");
    const branchResponse = await fetch(
      `${GITHUB_API_URL}/repos/${owner}/${repo}/branches`,
      { headers }
    );
    if (branchResponse.ok) {
      const branches = await branchResponse.json();
      const defaultBranch = branches.find((b: any) => b.name === 'main' || b.name === 'master' || b.name === 'staging');
      if (defaultBranch) {
        const commitSha = defaultBranch.commit.sha;
        
        // Try to read commit
        const commitResponse = await fetch(
          `${GITHUB_API_URL}/repos/${owner}/${repo}/git/commits/${commitSha}`,
          { headers }
        );
        console.log(`     GET commit: ${commitResponse.status} ${commitResponse.ok ? '✓' : '✗'}`);
        
        // Try to read tree
        if (commitResponse.ok) {
          const commitData = await commitResponse.json();
          const treeResponse = await fetch(
            `${GITHUB_API_URL}/repos/${owner}/${repo}/git/trees/${commitData.tree.sha}`,
            { headers }
          );
          console.log(`     GET tree: ${treeResponse.status} ${treeResponse.ok ? '✓' : '✗'}`);
        }
      }
    }

    // Test git database write
    console.log("\n  c) Git Database API (write):");
    
    // Get a base commit to test with
    const testBranch = branches[0];
    if (testBranch) {
      const baseCommitResponse = await fetch(
        `${GITHUB_API_URL}/repos/${owner}/${repo}/git/commits/${testBranch.commit.sha}`,
        { headers }
      );
      
      if (baseCommitResponse.ok) {
        const baseCommit = await baseCommitResponse.json();
        
        // Try to create a blob
        const blobResponse = await fetch(
          `${GITHUB_API_URL}/repos/${owner}/${repo}/git/blobs`,
          {
            method: "POST",
            headers: {
              ...headers,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              content: "test",
              encoding: "utf-8",
            }),
          }
        );
        console.log(`     POST blob: ${blobResponse.status} ${blobResponse.ok ? '✓' : '✗'}`);
        
        // Try to create a tree
        const treeResponse = await fetch(
          `${GITHUB_API_URL}/repos/${owner}/${repo}/git/trees`,
          {
            method: "POST",
            headers: {
              ...headers,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              base_tree: baseCommit.tree.sha,
              tree: [{
                path: "test-permission-check.txt",
                mode: "100644",
                type: "blob",
                content: "test",
              }],
            }),
          }
        );
        console.log(`     POST tree: ${treeResponse.status} ${treeResponse.ok ? '✓' : '✗'}`);
        
        if (!treeResponse.ok) {
          const error = await treeResponse.text();
          console.log(`     Error: ${error}`);
        }
      }
    }

    // 4. Check webhook/app events
    console.log("\n4. Checking Recent Activity:");
    const eventsResponse = await fetch(
      `${GITHUB_API_URL}/repos/${owner}/${repo}/events?per_page=10`,
      { headers }
    );
    
    if (eventsResponse.ok) {
      const events = await eventsResponse.json();
      const appEvents = events.filter((e: any) => 
        e.actor.login.includes('[bot]') || 
        e.actor.type === 'Bot'
      );
      
      console.log(`  Found ${appEvents.length} bot/app events in last 10 events`);
      appEvents.forEach((event: any) => {
        console.log(`  - ${event.actor.login}: ${event.type} at ${event.created_at}`);
      });
    }

    // 5. Summary and recommendations
    console.log("\n=== Analysis Summary ===");
    console.log("\nPossible causes for inconsistent 500 errors:");
    console.log("1. Race conditions with other bots (check events above)");
    console.log("2. Token scope varies based on who triggered the action");
    console.log("3. GitHub App needs to be reinstalled/reconfigured");
    console.log("4. Branch-specific protection rules");
    
  } catch (error) {
    console.error("\nError during diagnosis:", error);
  }
}

const [token, owner, repo] = process.argv.slice(2);
if (!token || !owner || !repo) {
  console.log("Usage: bun diagnose-app-permissions.ts <token> <owner> <repo>");
  console.log("\nThis script helps diagnose why GitHub App permissions are inconsistent.");
  process.exit(1);
}

diagnosePermissions(token, owner, repo);