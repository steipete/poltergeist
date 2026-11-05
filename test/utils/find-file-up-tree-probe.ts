import { posix, win32 } from "node:path";
import { FileSystemUtils } from "../../src/utils/filesystem.js";

type ProbeInput = {
  fileName: string;
  startDir: string;
  pathApi: "win32" | "posix";
  exists: string[];
};

const input = JSON.parse(process.argv[2]) as ProbeInput;
const pathApi = input.pathApi === "win32" ? win32 : posix;
const found = FileSystemUtils.findFileUpTree(input.fileName, input.startDir, {
  pathApi,
  exists: (candidate) => input.exists.includes(candidate),
});

process.stdout.write(JSON.stringify({ found }));
