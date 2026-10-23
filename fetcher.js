/**
 * fetcher.js - Asynchronous health check monitoring script.
 * Uses native Node.js (v18+) fetch and filesystem APIs (zero external dependencies).
 */

const fs = require('fs/promises');
const path = require('path');
const { performance } = require('perf_hooks');

const PROJECTS_FILE = path.join(__dirname, 'projects.json');
const OUTPUT_FILE = path.join(__dirname, 'raw_data.json');
const REQUEST_TIMEOUT_MS = 10000; // 10 seconds timeout per target

/**
 * Pings an individual target URL and captures performance metrics and status.
 * @param {Object} project - Target configuration { name, type, url }
 * @returns {Promise<Object>} Probe result data
 */
async function checkHealth(project) {
  const timestamp = new Date().toISOString();
  const startTime = performance.now();

  try {
    const response = await fetch(project.url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Antigravity-HealthCheck/1.0',
        'Accept': '*/*'
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    const responseTime = Math.round(performance.now() - startTime);

    return {
      name: project.name,
      type: project.type,
      url: project.url,
      status: response.status,
      statusText: response.statusText || (response.ok ? 'OK' : 'Error'),
      responseTimeMs: responseTime,
      isHealthy: response.ok, // HTTP 200-299
      timestamp,
      error: null
    };
  } catch (error) {
    const responseTime = Math.round(performance.now() - startTime);
    const isTimeout = error.name === 'TimeoutError' || error.name === 'AbortError';

    return {
      name: project.name,
      type: project.type,
      url: project.url,
      status: isTimeout ? 408 : 0,
      statusText: isTimeout ? 'Request Timeout' : 'Connection Failed',
      responseTimeMs: responseTime,
      isHealthy: false,
      timestamp,
      error: error.message || String(error)
    };
  }
}

/**
 * Main execution flow: reads projects, performs concurrent checks, writes output.
 */
async function main() {
  console.log('[Fetcher] Reading target projects configuration...');
  
  try {
    const rawConfig = await fs.readFile(PROJECTS_FILE, 'utf-8');
    const projects = JSON.parse(rawConfig);

    if (!Array.isArray(projects) || projects.length === 0) {
      throw new Error('projects.json is empty or not a valid JSON array.');
    }

    console.log(`[Fetcher] Running health checks for ${projects.length} targets...`);

    // Execute checks concurrently
    const results = await Promise.all(projects.map(checkHealth));

    // Construct final payload with metadata
    const payload = {
      meta: {
        generatedAt: new Date().toISOString(),
        totalChecked: results.length,
        healthyCount: results.filter(r => r.isHealthy).length,
        unhealthyCount: results.filter(r => !r.isHealthy).length
      },
      results
    };

    await fs.writeFile(OUTPUT_FILE, JSON.stringify(payload, null, 2), 'utf-8');
    console.log(`[Fetcher] Successfully wrote ${results.length} results to raw_data.json`);
  } catch (err) {
    console.error('[Fetcher] Error during health check execution:', err);
    process.exit(1);
  }
}

main();
