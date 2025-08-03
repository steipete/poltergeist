export function greet(name: string): string {
  return `Hello, ${name}!`;
}

export function getCurrentTime(): string {
  return new Date().toLocaleString();
}

// This is a TypeScript source file that should trigger builds when changed