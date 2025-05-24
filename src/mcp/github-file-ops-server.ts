#!/usr/bin/env node
// GitHub File Operations MCP Server - Enhanced with detailed error logging
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile } from "fs/promises";
import { join } from "path";
import fetch from "node-fetch";
// Import removed - define inline to ensure subprocess gets the value
const GITHUB_API_URL = process.env.GITHUB_API_URL || "https://api.github.com";

type GitHubRef = {
  object: {
    sha: string;
  };
};

type GitHubCommit = {
  tree: {
    sha: string;
  };
};

type GitHubTree = {
  sha: string;
};

type GitHubNewCommit = {
  sha: string;
  message: string;
  author: {
    name: string;
    date: string;
  };
};

// Get repository information from environment variables
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;
const BRANCH_NAME = process.env.BRANCH_NAME;
const REPO_DIR = process.env.REPO_DIR || process.cwd();

if (!REPO_OWNER || !REPO_NAME || !BRANCH_NAME) {
  console.error(
    "Error: REPO_OWNER, REPO_NAME, and BRANCH_NAME environment variables are required",
  );
  process.exit(1);
}

const server = new McpServer({
  name: "GitHub File Operations Server",
  version: "0.0.1",
});

// Enhanced error logging helper
function logDetailedError(prefix: string, error: any) {
  console.error(`[${prefix}] FULL ERROR CAUGHT:`, error);
  console.error(`[${prefix}] Error type:`, typeof error);
  console.error(`[${prefix}] Error constructor:`, error?.constructor?.name);
  console.error(`[${prefix}] Error stack:`, error instanceof Error ? error.stack : 'No stack trace');
  if (error && typeof error === 'object') {
    console.error(`[${prefix}] Error properties:`, Object.keys(error));
    console.error(`[${prefix}] Error JSON:`, JSON.stringify(error, null, 2));
  }
}

// Commit files tool
server.tool(
  "commit_files",
  "Commit one or more files to a repository in a single commit (this will commit them atomically in the remote repository)",
  {
    files: z
      .array(z.string())
      .describe(
        'Array of file paths relative to repository root (e.g. ["src/main.js", "README.md"]). All files must exist locally.',
      ),
    message: z.string().describe("Commit message"),
  },
  async ({ files, message }) => {
    const owner = REPO_OWNER;
    const repo = REPO_NAME;
    const branch = BRANCH_NAME;
    console.error(`[commit_files] Starting commit for ${files.length} files to ${owner}/${repo}:${branch}`);
    console.error(`[commit_files] REPO_DIR: ${REPO_DIR}`);
    console.error(`[commit_files] Input files:`, files);
    console.error(`[commit_files] Environment check:`, {
      GITHUB_TOKEN: process.env.GITHUB_TOKEN ? 'Present' : 'Missing',
      REPO_OWNER,
      REPO_NAME,
      BRANCH_NAME,
      REPO_DIR,
      GITHUB_API_URL,
      CWD: process.cwd(),
    });
    
    try {
      const githubToken = process.env.GITHUB_TOKEN;
      if (!githubToken) {
        throw new Error("GITHUB_TOKEN environment variable is required");
      }

      const processedFiles = files.map((filePath) => {
        if (filePath.startsWith("/")) {
          return filePath.slice(1);
        }
        return filePath;
      });

      // 1. Get the branch reference
      const refUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/refs/heads/${branch}`;
      const refResponse = await fetch(refUrl, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      if (!refResponse.ok) {
        throw new Error(
          `Failed to get branch reference: ${refResponse.status}`,
        );
      }

      const refData = (await refResponse.json()) as GitHubRef;
      const baseSha = refData.object.sha;

      // 2. Get the base commit
      const commitUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/commits/${baseSha}`;
      const commitResponse = await fetch(commitUrl, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      if (!commitResponse.ok) {
        throw new Error(`Failed to get base commit: ${commitResponse.status}`);
      }

      const commitData = (await commitResponse.json()) as GitHubCommit;
      const baseTreeSha = commitData.tree.sha;

      // 3. Create tree entries for all files
      const treeEntries = await Promise.all(
        processedFiles.map(async (filePath) => {
          const fullPath = filePath.startsWith("/")
            ? filePath
            : join(REPO_DIR, filePath);

          console.error(`[commit_files] Reading file: ${fullPath}`);
          const content = await readFile(fullPath, "utf-8").catch((error) => {
            console.error(`[commit_files] Failed to read file '${fullPath}':`, error);
            throw new Error(`Failed to read file '${fullPath}': ${error.message || error}`);
          });
          console.error(`[commit_files] Successfully read file: ${fullPath} (${content.length} chars)`);
          return {
            path: filePath,
            mode: "100644",
            type: "blob",
            content: content,
          };
        }),
      );

      // 4. Create a new tree
      const treeUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/trees`;
      const treeResponse = await fetch(treeUrl, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: treeEntries,
        }),
      });

      if (!treeResponse.ok) {
        const errorText = await treeResponse.text();
        throw new Error(
          `Failed to create tree: ${treeResponse.status} - ${errorText}`,
        );
      }

      const treeData = (await treeResponse.json()) as GitHubTree;

      // 5. Create a new commit
      const newCommitUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/commits`;
      const newCommitResponse = await fetch(newCommitUrl, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: message,
          tree: treeData.sha,
          parents: [baseSha],
        }),
      });

      if (!newCommitResponse.ok) {
        const errorText = await newCommitResponse.text();
        throw new Error(
          `Failed to create commit: ${newCommitResponse.status} - ${errorText}`,
        );
      }

      const newCommitData = (await newCommitResponse.json()) as GitHubNewCommit;

      // 6. Update the reference to point to the new commit
      const updateRefUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/refs/heads/${branch}`;
      console.error(`[commit_files] Updating reference: ${updateRefUrl}`);
      console.error(`[commit_files] New commit SHA: ${newCommitData.sha}`);
      console.error(`[commit_files] Base SHA was: ${baseSha}`);
      
      // Log full request context before making the request
      const requestBody = JSON.stringify({
        sha: newCommitData.sha,
        force: false,
      });
      const requestHeaders = {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${githubToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      };
      
      console.error(`[commit_files] Full request details:`, {
        url: updateRefUrl,
        method: 'PATCH',
        headers: {
          ...requestHeaders,
          Authorization: `Bearer [TOKEN_LENGTH:${githubToken?.length || 0}]`,
        },
        body: requestBody,
        timestamp: new Date().toISOString(),
        environment: {
          NODE_VERSION: process.version,
          PLATFORM: process.platform,
          ARCH: process.arch,
        },
        previousOperations: {
          treeCreated: treeData?.sha ? 'YES' : 'NO',
          commitCreated: newCommitData?.sha ? 'YES' : 'NO',
          treeSha: treeData?.sha,
          commitSha: newCommitData?.sha,
          baseSha: baseSha,
        }
      });
      
      // Log memory usage before request
      const memoryBefore = process.memoryUsage();
      console.error(`[commit_files] Memory before request:`, {
        rss: `${(memoryBefore.rss / 1024 / 1024).toFixed(2)} MB`,
        heapUsed: `${(memoryBefore.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      });
      
      let updateRefResponse;
      const requestStartTime = Date.now();
      
      try {
        updateRefResponse = await fetch(updateRefUrl, {
          method: "PATCH",
          headers: requestHeaders,
          body: requestBody,
        });
      } catch (fetchError) {
        const requestDuration = Date.now() - requestStartTime;
        console.error(`[commit_files] FETCH ERROR during reference update after ${requestDuration}ms:`, fetchError);
        logDetailedError('commit_files_fetch', fetchError);
        throw new Error(`Network error during reference update after ${requestDuration}ms: ${fetchError?.message || 'Unknown fetch error'}`);
      }
      
      const requestDuration = Date.now() - requestStartTime;
      console.error(`[commit_files] Request completed in ${requestDuration}ms`);
      console.error(`[commit_files] Response received at: ${new Date().toISOString()}`);

      console.error(`[commit_files] Update reference response status: ${updateRefResponse.status}`);
      console.error(`[commit_files] Response headers:`, Object.fromEntries(updateRefResponse.headers.entries()));
      
      // Log specific important headers
      console.error(`[commit_files] Key response headers:`, {
        'x-github-request-id': updateRefResponse.headers.get('x-github-request-id'),
        'x-ratelimit-remaining': updateRefResponse.headers.get('x-ratelimit-remaining'),
        'x-ratelimit-reset': updateRefResponse.headers.get('x-ratelimit-reset'),
        'content-type': updateRefResponse.headers.get('content-type'),
        'content-length': updateRefResponse.headers.get('content-length'),
        'server': updateRefResponse.headers.get('server'),
      });
      
      if (!updateRefResponse.ok) {
        console.error(`[commit_files] ERROR RESPONSE - Status: ${updateRefResponse.status} ${updateRefResponse.statusText}`);
        
        // Capture the entire raw response body
        let responseArrayBuffer;
        let responseText = '';
        let responseHex = '';
        let responseBase64 = '';
        
        try {
          // Clone the response so we can read it multiple ways
          const clonedResponse = updateRefResponse.clone();
          
          // Get raw bytes
          responseArrayBuffer = await updateRefResponse.arrayBuffer();
          const responseBytes = new Uint8Array(responseArrayBuffer);
          
          // Convert to text (with error handling for non-UTF8)
          responseText = new TextDecoder('utf-8', { fatal: false }).decode(responseBytes);
          
          // Convert to hex for debugging binary responses
          responseHex = Array.from(responseBytes.slice(0, 1000)) // First 1000 bytes to avoid huge logs
            .map(b => b.toString(16).padStart(2, '0'))
            .join(' ');
          
          // Convert to base64
          responseBase64 = Buffer.from(responseBytes).toString('base64');
          
          console.error(`[commit_files] COMPLETE ERROR RESPONSE:`);
          console.error(`[commit_files] ===== RESPONSE BODY (TEXT) =====`);
          console.error(responseText);
          console.error(`[commit_files] ===== END RESPONSE BODY =====`);
          console.error(`[commit_files] Response body length: ${responseBytes.length} bytes`);
          console.error(`[commit_files] Response body (first 1000 bytes as hex): ${responseHex}${responseBytes.length > 1000 ? '...' : ''}`);
          console.error(`[commit_files] Response body (base64): ${responseBase64}`);
          
          // Try to parse as JSON if it looks like JSON
          if (responseText.trim().startsWith('{') || responseText.trim().startsWith('[')) {
            try {
              const parsedError = JSON.parse(responseText);
              console.error(`[commit_files] Parsed error object:`, JSON.stringify(parsedError, null, 2));
            } catch (e) {
              console.error(`[commit_files] Response looks like JSON but failed to parse:`, e);
            }
          }
          
        } catch (readError) {
          console.error(`[commit_files] CRITICAL: Failed to read error response:`, readError);
          logDetailedError('commit_files_response_read', readError);
          responseText = `Failed to read response: ${readError}`;
        }
        
        // Log memory state after error
        const memoryAfter = process.memoryUsage();
        console.error(`[commit_files] Memory after error:`, {
          rss: `${(memoryAfter.rss / 1024 / 1024).toFixed(2)} MB`,
          heapUsed: `${(memoryAfter.heapUsed / 1024 / 1024).toFixed(2)} MB`,
        });
        
        // Special handling for 500 errors
        if (updateRefResponse.status === 500) {
          const requestId = updateRefResponse.headers.get('x-github-request-id');
          console.error(`[commit_files] ===== GITHUB 500 ERROR DETAILS =====`);
          console.error(`[commit_files] GitHub Request ID: ${requestId}`);
          console.error(`[commit_files] This is an internal GitHub server error`);
          console.error(`[commit_files] The error may be transient - consider retrying`);
          console.error(`[commit_files] Note: Tree (${treeData?.sha}) and commit (${newCommitData?.sha}) were created successfully`);
          console.error(`[commit_files] Only the reference update failed`);
          console.error(`[commit_files] ===================================`);
        }
        
        throw new Error(
          `Failed to update reference: ${updateRefResponse.status} - ${responseText || 'No response body'}`,
        );
      }

      const simplifiedResult = {
        commit: {
          sha: newCommitData.sha,
          message: newCommitData.message,
          author: newCommitData.author.name,
          date: newCommitData.author.date,
        },
        files: processedFiles.map((path) => ({ path })),
        tree: {
          sha: treeData.sha,
        },
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(simplifiedResult, null, 2),
          },
        ],
      };
    } catch (error) {
      logDetailedError('commit_files', error);
      
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`[commit_files] Final error message being thrown: "${errorMessage}"`);
      
      // Ensure we're throwing a proper Error object with a message
      if (!errorMessage || errorMessage === 'undefined' || errorMessage === '[object Object]') {
        console.error(`[commit_files] WARNING: Error message is undefined or object, using fallback`);
        const fallbackMessage = error instanceof Error && error.stack 
          ? `Failed to commit files: ${error.stack.split('\n')[0]}`
          : 'Failed to commit files: Unknown error occurred';
        throw new Error(fallbackMessage);
      }
      throw new Error(errorMessage);
    }
  },
);

// Delete files tool
server.tool(
  "delete_files",
  "Delete one or more files from a repository in a single commit",
  {
    paths: z
      .array(z.string())
      .describe(
        'Array of file paths to delete relative to repository root (e.g. ["src/old-file.js", "docs/deprecated.md"])',
      ),
    message: z.string().describe("Commit message"),
  },
  async ({ paths, message }) => {
    const owner = REPO_OWNER;
    const repo = REPO_NAME;
    const branch = BRANCH_NAME;
    try {
      const githubToken = process.env.GITHUB_TOKEN;
      if (!githubToken) {
        throw new Error("GITHUB_TOKEN environment variable is required");
      }

      // Convert absolute paths to relative if they match CWD
      const cwd = process.cwd();
      const processedPaths = paths.map((filePath) => {
        if (filePath.startsWith("/")) {
          if (filePath.startsWith(cwd)) {
            // Strip CWD from absolute path
            return filePath.slice(cwd.length + 1);
          } else {
            throw new Error(
              `Path '${filePath}' must be relative to repository root or within current working directory`,
            );
          }
        }
        return filePath;
      });

      // 1. Get the branch reference
      const refUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/refs/heads/${branch}`;
      const refResponse = await fetch(refUrl, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      if (!refResponse.ok) {
        throw new Error(
          `Failed to get branch reference: ${refResponse.status}`,
        );
      }

      const refData = (await refResponse.json()) as GitHubRef;
      const baseSha = refData.object.sha;

      // 2. Get the base commit
      const commitUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/commits/${baseSha}`;
      const commitResponse = await fetch(commitUrl, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      if (!commitResponse.ok) {
        throw new Error(`Failed to get base commit: ${commitResponse.status}`);
      }

      const commitData = (await commitResponse.json()) as GitHubCommit;
      const baseTreeSha = commitData.tree.sha;

      // 3. Create tree entries for file deletions (setting SHA to null)
      const treeEntries = processedPaths.map((path) => ({
        path: path,
        mode: "100644",
        type: "blob" as const,
        sha: null,
      }));

      // 4. Create a new tree with deletions
      const treeUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/trees`;
      const treeResponse = await fetch(treeUrl, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: treeEntries,
        }),
      });

      if (!treeResponse.ok) {
        const errorText = await treeResponse.text();
        throw new Error(
          `Failed to create tree: ${treeResponse.status} - ${errorText}`,
        );
      }

      const treeData = (await treeResponse.json()) as GitHubTree;

      // 5. Create a new commit
      const newCommitUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/commits`;
      const newCommitResponse = await fetch(newCommitUrl, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: message,
          tree: treeData.sha,
          parents: [baseSha],
        }),
      });

      if (!newCommitResponse.ok) {
        const errorText = await newCommitResponse.text();
        throw new Error(
          `Failed to create commit: ${newCommitResponse.status} - ${errorText}`,
        );
      }

      const newCommitData = (await newCommitResponse.json()) as GitHubNewCommit;

      // 6. Update the reference to point to the new commit
      const updateRefUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/refs/heads/${branch}`;
      console.error(`[delete_files] Updating reference: ${updateRefUrl}`);
      console.error(`[delete_files] New commit SHA: ${newCommitData.sha}`);
      console.error(`[delete_files] Base SHA was: ${baseSha}`);
      console.error(`[delete_files] Request body:`, JSON.stringify({
        sha: newCommitData.sha,
        force: false,
      }));
      
      let updateRefResponse;
      try {
        updateRefResponse = await fetch(updateRefUrl, {
          method: "PATCH",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${githubToken}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sha: newCommitData.sha,
            force: false,
          }),
        });
      } catch (fetchError) {
        console.error(`[delete_files] FETCH ERROR during reference update:`, fetchError);
        logDetailedError('delete_files_fetch', fetchError);
        throw new Error(`Network error during reference update: ${fetchError?.message || 'Unknown fetch error'}`);
      }

      console.error(`[delete_files] Update reference response status: ${updateRefResponse.status}`);
      console.error(`[delete_files] Response headers:`, Object.fromEntries(updateRefResponse.headers.entries()));
      
      if (!updateRefResponse.ok) {
        let errorText;
        try {
          errorText = await updateRefResponse.text();
        } catch (textError) {
          console.error(`[delete_files] Failed to read error response text:`, textError);
          errorText = 'Unable to read error response';
        }
        
        console.error(`[delete_files] Update reference error body: "${errorText}"`);
        console.error(`[delete_files] Error body length: ${errorText?.length}`);
        console.error(`[delete_files] Error body type: ${typeof errorText}`);
        
        // Log additional debugging info for 500 errors
        if (updateRefResponse.status === 500) {
          const requestId = updateRefResponse.headers.get('x-github-request-id');
          console.error(`[delete_files] GitHub Request ID: ${requestId}`);
          console.error(`[delete_files] This appears to be an internal GitHub error`);
          console.error(`[delete_files] Token was valid for tree/commit creation but failed for ref update`);
          console.error(`[delete_files] Branch protection rules or permissions might be an issue`);
        }
        
        // Parse error if it's JSON
        let parsedError;
        try {
          if (errorText && errorText.trim().startsWith('{')) {
            parsedError = JSON.parse(errorText);
            console.error(`[delete_files] Parsed error:`, parsedError);
          }
        } catch (e) {
          console.error(`[delete_files] Error text is not JSON`);
        }
        
        throw new Error(
          `Failed to update reference: ${updateRefResponse.status} - ${errorText}`,
        );
      }

      const simplifiedResult = {
        commit: {
          sha: newCommitData.sha,
          message: newCommitData.message,
          author: newCommitData.author.name,
          date: newCommitData.author.date,
        },
        deletedFiles: processedPaths.map((path) => ({ path })),
        tree: {
          sha: treeData.sha,
        },
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(simplifiedResult, null, 2),
          },
        ],
      };
    } catch (error) {
      logDetailedError('delete_files', error);
      
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`[delete_files] Final error message being thrown: "${errorMessage}"`);
      
      // Ensure we're throwing a proper Error object with a message
      if (!errorMessage || errorMessage === 'undefined' || errorMessage === '[object Object]') {
        console.error(`[delete_files] WARNING: Error message is undefined or object, using fallback`);
        const fallbackMessage = error instanceof Error && error.stack 
          ? `Failed to delete files: ${error.stack.split('\n')[0]}`
          : 'Failed to delete files: Unknown error occurred';
        throw new Error(fallbackMessage);
      }
      throw new Error(errorMessage);
    }
  },
);

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.on("exit", () => {
    server.close();
  });
}

runServer().catch(console.error);