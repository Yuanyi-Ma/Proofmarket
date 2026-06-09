import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export function createAuditFileLog(rootDir: string) {
  return {
    append(taskId: string, event: unknown): void {
      const file = join(rootDir, "data", "demo-state", `audit-${taskId}.jsonl`);
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, `${JSON.stringify(event)}\n`);
    }
  };
}
