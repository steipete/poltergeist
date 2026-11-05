import { posix, win32 } from "node:path";
import { FileSystemUtils } from "../../src/utils/filesystem.js";

type ProbeInput = {
  fileName: string;
  startDir: string;
  pathApi: "win32" | "posix";
  exists: string[];
};

type PathApi = typeof win32;

type WalkForFile = (
  fileName: string,
  startDir: string,
  pathApi: PathApi,
  exists: (candidate: string) => boolean,
) => string | null;

const input = JSON.parse(process.argv[2]) as ProbeInput;
const pathApi = input.pathApi === "win32" ? win32 : posix;
const walkForFile = (FileSystemUtils as unknown as { walkForFile: WalkForFile }).walkForFile;
const found = walkForFile.call(
  FileSystemUtils,
  input.fileName,
  input.startDir,
  pathApi,
  (candidate) => input.exists.includes(candidate),
);

process.stdout.write(JSON.stringify({ found }));
