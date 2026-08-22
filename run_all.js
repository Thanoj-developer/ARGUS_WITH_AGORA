const { spawn } = require('child_process');
const path = require('path');

function startProcess(name, command, args, cwd) {
  console.log(`[Launcher] Starting ${name} in ${cwd}...`);
  const child = spawn(command, args, { cwd, shell: true });

  child.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        console.log(`\x1b[36m[${name}]\x1b[0m ${line}`);
      }
    });
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        console.error(`\x1b[31m[${name} ERROR]\x1b[0m ${line}`);
      }
    });
  });

  child.on('close', (code) => {
    console.log(`[Launcher] ${name} process exited with code ${code}`);
  });

  return child;
}

const rootDir = __dirname;
const mcpDir = path.join(rootDir, 'MCP_TYPE');
const voiceDir = path.join(rootDir, 'voice');

console.log('==================================================');
console.log('🚀 Starting Playwright & Voice suite servers...');
console.log('==================================================');

const rootServer = startProcess('RootServer', 'node', ['server.js'], rootDir);
const mcpServer = startProcess('McpServer', 'node', ['MCP_Server.js'], mcpDir);
const voiceServer = startProcess('VoiceServer', 'node', ['voice_server.js'], voiceDir);

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('\n[Launcher] Stopping all servers...');
  try { rootServer.kill(); } catch (e) {}
  try { mcpServer.kill(); } catch (e) {}
  try { voiceServer.kill(); } catch (e) {}
  process.exit();
});
