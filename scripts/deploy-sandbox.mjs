// Runs `npx ampx sandbox --once` and fails unless the deployment really completed:
// the Amplify CLI exits with code 0 even when synthesis or deployment fails.
import { spawn } from "node:child_process";

const child = spawn("npx", ["ampx", "sandbox", "--once"], { shell: true, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => {
    output += chunk;
    process.stdout.write(chunk);
  });
}
child.on("close", (code) => {
  const ok = code === 0 && output.includes("Deployment completed") && !/\[ERROR\]|FATAL ERROR/.test(output);
  if (!ok) console.error("\nSandbox deployment FAILED (see the errors above).");
  process.exit(ok ? 0 : 1);
});
