import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execPromise = promisify(exec);

const SPECIAL_KEY_MAP: Record<string, string> = {
  '\r': 'return',
  '\n': 'return',
  '\t': 'tab',
  '\b': 'delete',
};

async function sendSpecialKey(name: string): Promise<void> {
  await execPromise(
    `/usr/bin/osascript -e 'tell application "iTerm2" to activate' -e 'tell application "System Events" to keystroke ${name}'`
  );
}

async function sendCharacter(char: string): Promise<void> {
  const escaped = char.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  await execPromise(
    `/usr/bin/osascript -e 'tell application "iTerm2" to activate' -e 'tell application "System Events" to keystroke "${escaped}"'`
  );
}

export async function sendKeys(text: string): Promise<void> {
  if (!text) return;
  for (const char of Array.from(text)) {
    const special = SPECIAL_KEY_MAP[char];
    if (special) {
      await sendSpecialKey(special);
    } else {
      await sendCharacter(char);
    }
  }
}
