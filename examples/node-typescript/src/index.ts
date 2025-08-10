interface BuildInfo {
  message: string;
  timestamp: Date;
  nodeVersion: string;
}

function getBuildInfo(): BuildInfo {
  return {
    message: 'Hello from TypeScript!',
    timestamp: new Date(),
    nodeVersion: process.version,
  };
}

const info = getBuildInfo();
console.log(`${info.message} Built at: ${info.timestamp.toISOString()}`);
console.log(`Node version: ${info.nodeVersion}`);
console.log('Testing the new logging system!');